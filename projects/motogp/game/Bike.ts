import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { PhysicsWorld } from '../core/physicsWorld';
import type { JoltModule } from '../core/jolt';
import { LAYER_MOVING } from '../core/jolt';
import {
  AERO,
  CHASSIS,
  CRASH,
  DIFFERENTIAL,
  ENGINE,
  LEAN,
  PHYSICS,
  STEERING,
  TRANSMISSION,
  TYRES,
  WHEELS,
} from '../config';
import type { InputIntent, Telemetry } from '../types';
import { AutomaticGearbox } from './AutomaticGearbox';
import { CrashDetector, type CrashEvent } from './CrashDetector';

type BodyID = InstanceType<JoltModule['BodyID']>;
type Body = InstanceType<JoltModule['Body']>;
type VehicleConstraint = InstanceType<JoltModule['VehicleConstraint']>;
type MotorcycleController = InstanceType<JoltModule['MotorcycleController']>;

const DEG = Math.PI / 180;
/** Chassis-center spawn height above ground (radius − attachY + margin). */
const SPAWN_Y = WHEELS.radius - WHEELS.attachY + 0.15;

/**
 * The motorcycle: jolt VehicleConstraint + MotorcycleController (lean spring),
 * driver-input smoothing and telemetry. Knows nothing about laps; visuals sync
 * via syncVisuals() into the exposed THREE.Group.
 */
export class Bike {
  readonly bodyId: BodyID;
  readonly root = new THREE.Group(); // chassis transform target; caller adds to scene
  /** Resolves after the Ducati GLB has loaded, or after fallback loading fails. */
  readonly ready: Promise<void>;
  /** Wheel assemblies: tyre, rim, rotor, and a coloured hub. */
  readonly wheelMeshes: THREE.Group[] = [];
  /** Rebuilt by rebuild() — always access through this field. */
  constraint: VehicleConstraint;
  controller: MotorcycleController;

  telemetry: Telemetry = {
    speedKph: 0,
    rpm: 0,
    gear: 1,
    leanDeg: 0,
    wheelContacts: [false, false],
    crashed: false,
    impactSeverity: 0,
  };

  private world: PhysicsWorld;
  private Jolt: JoltModule;
  private body: Body;
  private steerCurrent = 0; // -1..1 after input shaping and speed cap
  /** Emergency fallback parts — removed once the authored Ducati GLB loads. */
  private placeholderBody = new THREE.Group();
  private stepListener: InstanceType<JoltModule['VehicleConstraintStepListener']> | null = null;
  /** Signed longitudinal speed in m/s (+forward). Updated in postPhysicsUpdate. */
  private forwardSpeed = 0;
  /** Reusable target for getForwardInto in fixed-step code (no THREE import needed). */
  private fwdTmp = { x: 0, y: 0, z: 0 };
  private riderVisual: THREE.Object3D | null = null;
  private riderCockpitHands: THREE.Object3D | null = null;
  private riderCockpitArms: THREE.Object3D | null = null;
  private riderVisible = true;
  /** GLTF materials are shared by many primitives; finish each source once. */
  private readonly enhancedMaterials = new WeakMap<THREE.Material, THREE.Material>();
  private leatherMicroMap: THREE.CanvasTexture | null = null;
  private carbonMicroMap: THREE.CanvasTexture | null = null;
  private readonly liveryResources: Array<{ dispose(): void }> = [];
  private readonly crashDetector = new CrashDetector();
  private vehicleConstraintAttached = true;
  private riderCrashBodyId: BodyID | null = null;
  private riderHomeParent: THREE.Object3D | null = null;
  private riderHomePosition = new THREE.Vector3();
  private riderHomeQuaternion = new THREE.Quaternion();
  private riderHomeScale = new THREE.Vector3(1, 1, 1);
  private readonly riderCrashRelative = new THREE.Matrix4();
  private readonly crashBodyMatrix = new THREE.Matrix4();
  private readonly crashWorldMatrix = new THREE.Matrix4();
  private readonly crashParentInverse = new THREE.Matrix4();
  private readonly crashCenter = new THREE.Vector3();
  private readonly crashRotation = new THREE.Quaternion();
  private readonly crashScale = new THREE.Vector3(1, 1, 1);
  private previousVelocity = new THREE.Vector3();
  private hasPreviousVelocity = false;
  private readonly posePreviousPosition = new THREE.Vector3();
  private readonly poseCurrentPosition = new THREE.Vector3();
  private readonly posePreviousQuaternion = new THREE.Quaternion();
  private readonly poseCurrentQuaternion = new THREE.Quaternion();
  private hasPhysicsPose = false;
  /**
   * Render-safe copies of wheel state. Jolt wheel wrappers are borrowed WASM
   * handles and become invalid as soon as a crash detaches the constraint.
   * The render loop must never retain or query them.
   */
  private readonly wheelSuspensionLength = [WHEELS.suspensionMaxLength, WHEELS.suspensionMaxLength];
  private readonly wheelRotationAngle = [0, 0];
  private readonly wheelSteerAngle = [0, 0];
  private readonly gearbox = new AutomaticGearbox({
    gearRatios: TRANSMISSION.gearRatios,
    differentialRatio: DIFFERENTIAL.ratio,
    wheelRadiusM: WHEELS.radius,
    maxRpm: ENGINE.maxRpm,
    shiftUpRpm: TRANSMISSION.shiftUpRpm,
    shiftDownRpm: TRANSMISSION.shiftDownRpm,
    kickdownRpm: TRANSMISSION.kickdownRpm,
    shiftDurationSec: TRANSMISSION.shiftDurationSec,
    shiftLockoutSec: TRANSMISSION.shiftLockoutSec,
  });

  constructor(world: PhysicsWorld, spawn: { x: number; y: number; z: number }, yawRad = 0) {
    this.world = world;
    this.Jolt = world.Jolt;
    const { Jolt, bodyInterface } = world;

    // --- chassis body: box with lowered center of mass ------------------------
    const boxSettings = new Jolt.BoxShapeSettings(
      new Jolt.Vec3(CHASSIS.halfExtents.x, CHASSIS.halfExtents.y, CHASSIS.halfExtents.z),
      0,
      undefined,
    );
    const comSettings = new Jolt.OffsetCenterOfMassShapeSettings(
      new Jolt.Vec3(CHASSIS.comOffset.x, CHASSIS.comOffset.y, CHASSIS.comOffset.z),
      boxSettings,
    );
    const shape = comSettings.Create().Get(); // ownership transferred out of result

    const bcs = new Jolt.BodyCreationSettings(
      shape,
      new Jolt.RVec3(spawn.x, spawn.y + SPAWN_Y, spawn.z),
      Jolt.Quat.prototype.sRotation(new Jolt.Vec3(0, 1, 0), yawRad),
      Jolt.EMotionType_Dynamic,
      LAYER_MOVING,
    );
    bcs.mOverrideMassProperties = Jolt.EOverrideMassProperties_CalculateInertia;
    bcs.mMassPropertiesOverride.mMass = CHASSIS.massKg;
    bcs.mMotionQuality = Jolt.EMotionQuality_LinearCast;
    bcs.mAllowSleeping = false;

    this.body = bodyInterface.CreateBody(bcs);
    this.bodyId = this.body.GetID();
    this.body.SetFriction(CHASSIS.friction);
    this.body.SetRestitution(CHASSIS.restitution);
    bodyInterface.AddBody(this.bodyId, Jolt.EActivation_Activate);
    // bcs/shape/settings stay alive — creation chains belong to the binding
    // (jolt.ts memory rules; destroying them corrupts the heap with delay).

    // --- vehicle constraint ---------------------------------------------------
    this.constraint = this.buildConstraint(this.body);
    world.physicsSystem.AddConstraint(this.constraint);
    this.addStepListener();
    this.controller = Jolt.castObject(this.constraint.GetController(), Jolt.MotorcycleController);
    this.applyGearboxReset();

    this.buildPlaceholderVisuals();
    this.ready = this.loadModel();
  }

  /** Preload suspension behind the loading screen so the bike never drops from a floating pose. */
  settleSuspension(durationSec = 0.42): void {
    this.controller.SetDriverInput(0, 0, 1, 0);
    const steps = Math.ceil(durationSec * PHYSICS.fixedHz);
    for (let i = 0; i < steps; i++) this.world.step(1 / PHYSICS.fixedHz);
    const zero = new this.Jolt.Vec3(0, 0, 0);
    this.world.bodyInterface.SetLinearAndAngularVelocity(this.bodyId, zero, zero);
    this.Jolt.destroy(zero);
    this.controller.SetDriverInput(0, 0, 0, 0);
    this.hasPhysicsPose = false;
    this.captureWheelState();
    this.syncVisuals();
  }

  /**
   * Swap the fallback for the single Blender-authored Ducati + rider assembly.
   * Blender already established the real-world scale, forward axis and rider
   * contacts, so runtime must not normalize or rotate the model again.
   */
  private async loadModel(): Promise<void> {
    try {
      const loader = new GLTFLoader();
      const gltf = await loader.loadAsync('/motogp/ducati-rider-game-rig.glb');
      gltf.scene.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh)) return;
        obj.castShadow = true;
        obj.receiveShadow = true;
        this.enhanceBikeMaterial(obj);
      });
      this.finishDucatiTailCowl(gltf.scene);

      const mount = new THREE.Group();
      mount.name = 'MarcMarquez93Ducati';
      // Physics root is the chassis centre; the Blender assembly is ground-based.
      // The settled Jolt chassis rides 0.975 m above the authored asphalt.
      // Mount the ground-based Blender assembly by the same amount so its tyre
      // contact patches—not its object origin—sit on the physical road.
      mount.position.set(0, -0.975, 0);
      mount.add(gltf.scene);
      this.riderVisual = gltf.scene.getObjectByName('Marc93_Rider_Baked_Final') ?? null;
      this.riderCockpitHands = gltf.scene.getObjectByName('Marc93_Rider_Hands_Cockpit') ?? null;
      this.addRiderRaceHump();
      this.addMarc93BackMarking();
      this.addDucatiTailBadge(gltf.scene);
      try {
        const cockpit = await loader.loadAsync('/motogp/ducati-rider-cockpit-arms.glb');
        cockpit.scene.name = 'Marc93CockpitArmsAssembly';
        cockpit.scene.traverse((obj) => {
          if (!(obj instanceof THREE.Mesh)) return;
          obj.castShadow = true;
          obj.receiveShadow = true;
          this.enhanceBikeMaterial(obj);
        });
        this.riderCockpitArms = cockpit.scene;
        gltf.scene.add(cockpit.scene);
      } catch (error) {
        // Keep the older glove-only shell as a fallback if the small cockpit
        // asset is unavailable in a development build.
        console.warn('[MotoGP] Cockpit arms asset unavailable; using glove fallback.', error);
      }
      if (this.riderVisual) {
        this.riderHomeParent = this.riderVisual.parent;
        this.riderHomePosition.copy(this.riderVisual.position);
        this.riderHomeQuaternion.copy(this.riderVisual.quaternion);
        this.riderHomeScale.copy(this.riderVisual.scale);
      }
      this.updateRiderVisibility();

      this.placeholderBody.removeFromParent();
      for (const wheel of this.wheelMeshes) wheel.visible = false;
      this.root.add(mount);
    } catch {
      // Model missing/broken — the placeholder stays. Fine for a dev build.
    }
  }

  /** Rider view swaps the body shell for the baked gloves gripping the clip-ons. */
  setRiderVisible(visible: boolean): void {
    this.riderVisible = visible;
    this.updateRiderVisibility();
  }

  private updateRiderVisibility(): void {
    const cockpitView = !this.telemetry.crashed && !this.riderVisible;
    if (this.riderVisual) this.riderVisual.visible = this.telemetry.crashed || this.riderVisible;
    if (this.riderCockpitArms) this.riderCockpitArms.visible = cockpitView;
    if (this.riderCockpitHands) {
      this.riderCockpitHands.visible = cockpitView && this.riderCockpitArms === null;
    }
  }

  /**
   * The supplied tail is split across a painted cowl, upper shell and lower
   * undertray. Give those exact meshes dedicated finishes after the shared
   * material pass so pale shared textures cannot wash the rear assembly out.
   */
  private finishDucatiTailCowl(sceneRoot: THREE.Object3D): void {
    const parts: Array<{ names: string[]; finish: 'paint' | 'carbon' }> = [
      { names: ['Object_34001', 'Object_34.001', 'Object_34'], finish: 'paint' },
      { names: ['Object_38001', 'Object_38.001', 'Object_38'], finish: 'paint' },
      { names: ['Object_40001', 'Object_40.001', 'Object_40'], finish: 'carbon' },
    ];
    for (const part of parts) {
      const object = part.names.map((name) => sceneRoot.getObjectByName(name)).find(Boolean);
      if (!(object instanceof THREE.Mesh)) continue;
      const sources = Array.isArray(object.material) ? object.material : [object.material];
      const finished = sources.map((source) => {
        if (!(source instanceof THREE.MeshStandardMaterial)) return source;
        const material = source.clone();
        material.map = null;
        material.metalness = 0;
        if (part.finish === 'paint') {
          material.name = 'DucatiCorseTailClearcoat';
          material.color.set(0x920018);
          material.roughness = 0.16;
          material.envMapIntensity = 1.42;
          if (material instanceof THREE.MeshPhysicalMaterial) {
            material.clearcoat = 1;
            material.clearcoatRoughness = 0.105;
          }
        } else {
          material.name = 'DucatiCorseTailCarbonUndertray';
          material.color.set(0x171a1e);
          material.roughness = 0.3;
          material.envMapIntensity = 0.92;
          material.bumpMap = this.getCarbonMicroMap();
          material.bumpScale = 0.004;
          if (material instanceof THREE.MeshPhysicalMaterial) {
            material.clearcoat = 0.58;
            material.clearcoatRoughness = 0.24;
          }
        }
        material.needsUpdate = true;
        this.liveryResources.push(material);
        return material;
      });
      object.material = Array.isArray(object.material) ? finished : finished[0]!;
    }
  }

  /** Preserve the authored livery while separating its real-world finishes. */
  private enhanceBikeMaterial(mesh: THREE.Mesh): void {
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const enhanced = materials.map((source) => {
      const cached = this.enhancedMaterials.get(source);
      if (cached) return cached;
      let material = source;
      if (!(material instanceof THREE.MeshStandardMaterial)) {
        this.enhancedMaterials.set(source, material);
        return material;
      }
      const name = material.name.toLowerCase();
      const identity = `${mesh.name} ${name}`.toLowerCase();
      const rider = /rider|hands|arms|marc93|ch20_body/.test(identity);
      const tailCowl = /object_34(?:\.001)?|frontcolor/.test(identity);
      const seat = /carpet_plush_charcoal|\bseat\b/.test(identity);
      const glass = /glass|windscreen|screen|visor|translucent/.test(name) ||
        (material.transparent && material.opacity < 0.72);
      const carbon = !rider && /carbon|mudguard002|motogpu00f915/.test(name);
      const rubber = !rider && /tyre|tire|rubber|wheelfront1mtl|wheelrear0061mtl/.test(name);
      const brakeMetal = /brake|disc|rotor|wheelfixedfront31/.test(name);
      const darkRim = /velg|rim|wheelfixedfront21|wheelfront005/.test(name);
      const warmMetal = /forcella1|forksrear00111/.test(name);
      const metal = !rubber && !carbon && !glass &&
        /metal|silver|bolt|fork|forcella|chain|rearset|velg|handlebars|wheelfixed|wheelfront00/.test(name);
      const fairing = !rider && !glass && !carbon &&
        /motogpu|ducati|021615|frontcolor|m_0020_red|mediumblue/.test(name);
      if (!(material instanceof THREE.MeshPhysicalMaterial)) {
        if (glass) material = this.toPhysicalGlass(material);
        else if (rider || seat) material = this.toPhysicalRider(material);
        else if (carbon) material = this.toPhysicalCarbon(material);
        else if (metal) material = this.toPhysicalBrushedMetal(material);
        else if (fairing) material = this.toPhysicalFairing(material);
      }
      if (material.map) {
        material.map.colorSpace = THREE.SRGBColorSpace;
        material.map.anisotropy = Math.max(material.map.anisotropy, 12);
      }
      if (material.normalMap) material.normalMap.colorSpace = THREE.NoColorSpace;
      if (material.roughnessMap) material.roughnessMap.colorSpace = THREE.NoColorSpace;
      if (material.metalnessMap) material.metalnessMap.colorSpace = THREE.NoColorSpace;
      if (material.aoMap) material.aoMap.colorSpace = THREE.NoColorSpace;

      if (glass) {
        material.color.set(0x283442);
        material.metalness = 0;
        material.roughness = 0.075;
        material.envMapIntensity = 1.5;
      } else if (rider) {
        // White is the neutral multiplier for the baked Marc 93 albedo. The
        // old grey-red vertex tint made every part read as the same vinyl toy.
        material.color.set(0xffffff);
        material.metalness = 0;
        material.roughness = 0.48;
        material.envMapIntensity = 0.82;
      } else if (seat) {
        material.color.set(0x111419);
        material.metalness = 0;
        material.roughness = 0.76;
        material.clearcoat = 0.08;
        material.clearcoatRoughness = 0.62;
        material.envMapIntensity = 0.42;
      } else if (metal) {
        material.metalness = Math.max(material.metalness, 0.92);
        material.roughness = brakeMetal ? 0.34 : darkRim ? 0.3 : 0.25;
        if (!material.map) {
          if (warmMetal) material.color.set(0xc9a45c);
          else if (darkRim) material.color.set(0x171b20);
          else if (brakeMetal) material.color.set(0xa8adb2);
          else material.color.set(0x8e959d);
        }
      } else if (carbon) {
        // Carbon fibre is a coated dielectric composite, not bare metal.
        material.color.set(material.map ? 0xbfc3c7 : 0x24272b);
        material.metalness = 0;
        material.roughness = 0.31;
        if (!material.bumpMap) material.bumpMap = this.getCarbonMicroMap();
        material.bumpScale = 0.005;
      } else if (rubber) {
        material.color.set(material.map ? 0x8a8e91 : 0x2d3033);
        material.metalness = 0;
        material.roughness = 0.82;
        material.envMapIntensity = 0.28;
      } else if (fairing) {
        // Painted bodywork is a dielectric base beneath a glossy clear coat.
        // The authored tail slot carries a pale base texture in the exported
        // GLB, so the Ducati tint must win over the neutral texture multiplier.
        material.color.set(tailCowl ? 0x920018 : material.map ? 0xffffff : 0xb90820);
        material.metalness = 0;
        material.roughness = tailCowl ? 0.16 : 0.205;
        if (tailCowl) {
          material.clearcoat = 1;
          material.clearcoatRoughness = 0.105;
          material.envMapIntensity = 1.42;
        }
      }
      if (!rider && !rubber && !glass) {
        material.envMapIntensity = metal ? 1.35 : fairing || carbon ? 1.08 : 0.82;
      }
      material.needsUpdate = true;
      this.enhancedMaterials.set(source, material);
      this.enhancedMaterials.set(material, material);
      return material;
    });
    mesh.material = Array.isArray(mesh.material) ? enhanced : enhanced[0]!;
    if (/rider|hands|arms|marc93|ch20/i.test(mesh.name)) {
      this.applyRiderMaterialZones(mesh, enhanced);
    }
  }

  /**
   * The supplied rider is one baked mesh/material. Reorder triangles into
   * physical finish zones so the UV livery stays intact while the helmet,
   * leather and protective pieces react differently to light.
   */
  private applyRiderMaterialZones(mesh: THREE.Mesh, materials: THREE.Material[]): void {
    if (materials.length !== 1) return;
    const base = materials[0];
    if (!(base instanceof THREE.MeshPhysicalMaterial)) return;
    const position = mesh.geometry.getAttribute('position');
    if (!position) return;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const bounds = mesh.geometry.boundingBox;
    if (!bounds) return;
    const spanY = Math.max(1e-4, bounds.max.y - bounds.min.y);
    const cockpitLimb = /hands|arms|cockpit/i.test(mesh.name);
    const leather = base.clone();
    leather.name = `${base.name}:race-leather`;
    leather.color.set(0xf4eeee);
    leather.roughness = cockpitLimb ? 0.42 : 0.48;
    leather.clearcoat = 0.06;
    leather.clearcoatRoughness = 0.42;
    leather.sheen = 0.34;
    leather.sheenRoughness = 0.72;
    leather.sheenColor.set(0x8d1827);
    if (!leather.bumpMap) leather.bumpMap = this.getLeatherMicroMap();
    leather.bumpScale = 0.007;

    const helmet = base.clone();
    helmet.name = `${base.name}:ducati-red-helmet-shell`;
    helmet.map = null;
    helmet.color.set(0xb60920);
    helmet.roughness = 0.12;
    helmet.clearcoat = 0.96;
    helmet.clearcoatRoughness = 0.07;
    helmet.envMapIntensity = 1.28;
    helmet.bumpMap = base.bumpMap;
    helmet.vertexColors = false;

    const visor = helmet.clone();
    visor.name = `${base.name}:smoked-visor`;
    visor.color.set(0x121a24);
    visor.roughness = 0.055;
    visor.clearcoat = 1;
    visor.clearcoatRoughness = 0.035;
    visor.envMapIntensity = 1.55;

    const protective = base.clone();
    protective.name = `${base.name}:gloves-boots`;
    protective.color.set(0xd9d4d4);
    protective.roughness = 0.37;
    protective.clearcoat = 0.2;
    protective.clearcoatRoughness = 0.3;
    protective.envMapIntensity = 0.74;
    if (!protective.bumpMap) protective.bumpMap = this.getLeatherMicroMap();
    protective.bumpScale = 0.009;

    if (cockpitLimb) {
      mesh.material = [leather, protective];
    } else {
      mesh.material = [leather, helmet, visor, protective];
    }

    const liveryColour = new Float32Array(position.count * 3);
    const spanZ = Math.max(1e-4, bounds.max.z - bounds.min.z);
    for (let i = 0; i < position.count; i++) {
      const height = (position.getY(i) - bounds.min.y) / spanY;
      const lateral = Math.abs(position.getX(i)) / Math.max(1e-4, Math.max(Math.abs(bounds.min.x), Math.abs(bounds.max.x)));
      let r = 1;
      let g = 0.96;
      let b = 0.96;
      if (cockpitLimb) {
        if (lateral > 0.68) {
          r = 0.34;
          g = 0.35;
          b = 0.38;
        }
      } else if (height < 0.27) {
        r = 0.38;
        g = 0.39;
        b = 0.42;
      } else if (height < 0.72 && height > 0.31 && lateral > 0.48) {
        // Charcoal flank panels keep the Ducati-red centre visually narrow,
        // like a tailored factory race suit instead of a one-colour jumpsuit.
        r = 0.28;
        g = 0.29;
        b = 0.32;
      }
      liveryColour[i * 3] = r;
      liveryColour[i * 3 + 1] = g;
      liveryColour[i * 3 + 2] = b;
    }
    mesh.geometry.setAttribute('color', new THREE.Float32BufferAttribute(liveryColour, 3));
    leather.vertexColors = true;
    protective.vertexColors = true;

    const sourceIndex = mesh.geometry.getIndex();
    const indices = sourceIndex
      ? Array.from(sourceIndex.array)
      : Array.from({ length: position.count }, (_, i) => i);
    const buckets: number[][] = cockpitLimb ? [[], []] : [[], [], [], []];
    const halfWidth = Math.max(Math.abs(bounds.min.x), Math.abs(bounds.max.x));
    for (let tri = 0; tri + 2 < indices.length; tri += 3) {
      const a = indices[tri]!;
      const b = indices[tri + 1]!;
      const c = indices[tri + 2]!;
      const height = ((position.getY(a) + position.getY(b) + position.getY(c)) / 3 - bounds.min.y) / spanY;
      const lateral = Math.abs((position.getX(a) + position.getX(b) + position.getX(c)) / 3);
      let zone = 0;
      if (cockpitLimb) zone = lateral > halfWidth * 0.68 ? 1 : 0;
      else if (height > 0.76) {
        const depth = ((position.getZ(a) + position.getZ(b) + position.getZ(c)) / 3 - bounds.min.z) / spanZ;
        zone = depth > 0.72 ? 2 : 1;
      } else if (height < 0.27 || (height < 0.58 && lateral > halfWidth * 0.7)) zone = 3;
      buckets[zone]!.push(a, b, c);
    }
    mesh.geometry.setIndex(buckets.flat());
    mesh.geometry.clearGroups();
    let groupStart = 0;
    for (let zone = 0; zone < buckets.length; zone++) {
      const count = buckets[zone]!.length;
      if (count > 0) mesh.geometry.addGroup(groupStart, count, zone);
      groupStart += count;
    }
  }

  private getLeatherMicroMap(): THREE.CanvasTexture {
    if (this.leatherMicroMap) return this.leatherMicroMap;
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#777';
    ctx.fillRect(0, 0, 128, 128);
    let seed = 93;
    for (let i = 0; i < 1900; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const x = seed & 127;
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const y = seed & 127;
      const shade = 104 + ((seed >>> 24) & 31);
      ctx.fillStyle = `rgb(${shade},${shade},${shade})`;
      ctx.fillRect(x, y, 1, 1);
    }
    this.leatherMicroMap = new THREE.CanvasTexture(canvas);
    this.leatherMicroMap.name = 'Marc93LeatherMicroBump';
    this.leatherMicroMap.colorSpace = THREE.NoColorSpace;
    this.leatherMicroMap.wrapS = THREE.RepeatWrapping;
    this.leatherMicroMap.wrapT = THREE.RepeatWrapping;
    this.leatherMicroMap.repeat.set(22, 22);
    return this.leatherMicroMap;
  }

  private getCarbonMicroMap(): THREE.CanvasTexture {
    if (this.carbonMicroMap) return this.carbonMicroMap;
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#666';
    ctx.fillRect(0, 0, 64, 64);
    ctx.lineWidth = 2;
    for (let offset = -64; offset < 128; offset += 8) {
      ctx.strokeStyle = offset % 16 === 0 ? '#8b8b8b' : '#484848';
      ctx.beginPath();
      ctx.moveTo(offset, 0);
      ctx.lineTo(offset + 64, 64);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(offset + 64, 0);
      ctx.lineTo(offset, 64);
      ctx.stroke();
    }
    this.carbonMicroMap = new THREE.CanvasTexture(canvas);
    this.carbonMicroMap.name = 'DucatiCarbonTwillBump';
    this.carbonMicroMap.colorSpace = THREE.NoColorSpace;
    this.carbonMicroMap.wrapS = THREE.RepeatWrapping;
    this.carbonMicroMap.wrapT = THREE.RepeatWrapping;
    this.carbonMicroMap.repeat.set(18, 18);
    return this.carbonMicroMap;
  }

  /** Teardrop aerodynamic protector fitted to the baked rider's upper spine. */
  private addRiderRaceHump(): void {
    if (!this.riderVisual) return;
    const geometry = new THREE.SphereGeometry(1, 24, 18);
    const position = geometry.getAttribute('position');
    for (let i = 0; i < position.count; i++) {
      const vertical = THREE.MathUtils.clamp((position.getY(i) + 1) * 0.5, 0, 1);
      // MotoGP humps are broad at the shoulders and taper toward the lumbar
      // spine; shaping the mesh avoids the stuck-on egg silhouette.
      const taper = THREE.MathUtils.lerp(0.5, 1, THREE.MathUtils.smoothstep(vertical, 0.08, 0.84));
      position.setX(i, position.getX(i) * taper);
      position.setZ(i, position.getZ(i) * THREE.MathUtils.lerp(0.7, 1, vertical));
    }
    position.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.scale(9, 17, 7);
    const material = new THREE.MeshPhysicalMaterial({
      name: 'Marc93AerodynamicRaceHumpLeather',
      color: 0xa9081d,
      roughness: 0.32,
      metalness: 0,
      clearcoat: 0.16,
      clearcoatRoughness: 0.28,
      sheen: 0.3,
      sheenRoughness: 0.68,
      sheenColor: new THREE.Color(0x7d1523),
      bumpMap: this.getLeatherMicroMap(),
      bumpScale: 0.006,
      envMapIntensity: 0.8,
    });
    const hump = new THREE.Mesh(geometry, material);
    hump.name = 'Marc93AerodynamicRaceHump';
    hump.position.set(0, 114, -2.5);
    hump.rotation.x = 0.43;
    hump.castShadow = true;
    hump.receiveShadow = true;
    this.riderVisual.add(hump);
    this.liveryResources.push(geometry, material);
  }

  /** Small racewear-scale marking integrated into the aerodynamic hump. */
  private addMarc93BackMarking(): void {
    if (!this.riderVisual) return;
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 384;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.font = 'italic 900 228px Arial, sans-serif';
    ctx.lineWidth = 30;
    ctx.strokeStyle = '#11151c';
    ctx.strokeText('93', 256, 190);
    ctx.lineWidth = 10;
    ctx.strokeStyle = '#c70922';
    ctx.strokeText('93', 256, 190);
    ctx.fillStyle = '#f4f0e8';
    ctx.fillText('93', 256, 190);
    ctx.font = '800 27px Arial, sans-serif';
    ctx.letterSpacing = '4px';
    ctx.fillStyle = '#11151c';
    ctx.fillText('DUCATI CORSE', 256, 57);
    ctx.font = '700 24px Arial, sans-serif';
    ctx.letterSpacing = '3px';
    ctx.fillText('MARC MARQUEZ', 256, 327);

    const texture = new THREE.CanvasTexture(canvas);
    texture.name = 'Marc93RacewearBackMarking';
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 12;
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      alphaTest: 0.08,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: true,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    const geometry = new THREE.PlaneGeometry(20, 15);
    // Rear chase sees the rider from local -Z; flip the plane itself so the
    // double-sided texture never presents a mirrored 93.
    geometry.rotateY(Math.PI);
    const marking = new THREE.Mesh(geometry, material);
    marking.name = 'Marc93SuitBackMarking';
    // The baked torso leans forward sharply; sit just behind its rear surface
    // (local -Z) and follow that rake so the marking reads as printed leather.
    marking.position.set(0, 114, -15.5);
    marking.rotation.x = 0.43;
    marking.renderOrder = 6;
    this.riderVisual.add(marking);
    this.liveryResources.push(texture, material, geometry);
  }

  /**
   * A small, paint-scale identity badge on the authored Ducati tail cowl.
   * The cowl itself remains the supplied mesh; this decal is deliberately
   * render-only so it cannot change the motorcycle's collision or handling.
   */
  private addDucatiTailBadge(sceneRoot: THREE.Object3D): void {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 288;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.beginPath();
    ctx.moveTo(74, 34);
    ctx.lineTo(438, 34);
    ctx.lineTo(470, 104);
    ctx.lineTo(414, 245);
    ctx.lineTo(256, 278);
    ctx.lineTo(98, 245);
    ctx.lineTo(42, 104);
    ctx.closePath();
    ctx.fillStyle = '#080b10';
    ctx.fill();
    ctx.lineWidth = 22;
    ctx.strokeStyle = '#ba001f';
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.font = 'italic 900 184px Arial, sans-serif';
    ctx.lineWidth = 22;
    ctx.strokeStyle = '#ba001f';
    ctx.strokeText('93', 256, 158);
    ctx.fillStyle = '#f2eee5';
    ctx.fillText('93', 256, 158);
    ctx.font = '800 25px Arial, sans-serif';
    ctx.letterSpacing = '4px';
    ctx.fillText('DUCATI CORSE', 256, 52);

    const texture = new THREE.CanvasTexture(canvas);
    texture.name = 'DucatiCorseTail93Badge';
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 12;
    const material = new THREE.MeshBasicMaterial({
      name: 'DucatiCorseTail93BadgeMaterial',
      map: texture,
      transparent: true,
      alphaTest: 0.08,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: true,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    const geometry = new THREE.PlaneGeometry(0.105, 0.059);
    // Blender's rear-facing +Y surface imports as Three.js -Z.
    geometry.rotateY(Math.PI);
    const badge = new THREE.Mesh(geometry, material);
    badge.name = 'DucatiCorseTail93Badge';
    badge.position.set(0, 0.921, -0.507);
    badge.renderOrder = 7;
    sceneRoot.add(badge);
    this.liveryResources.push(texture, material, geometry);
  }

  private toPhysicalFairing(source: THREE.MeshStandardMaterial): THREE.MeshPhysicalMaterial {
    const material = new THREE.MeshPhysicalMaterial({
      name: source.name,
      color: source.color,
      map: source.map,
      lightMap: source.lightMap,
      lightMapIntensity: source.lightMapIntensity,
      aoMap: source.aoMap,
      aoMapIntensity: source.aoMapIntensity,
      emissive: source.emissive,
      emissiveIntensity: source.emissiveIntensity,
      emissiveMap: source.emissiveMap,
      bumpMap: source.bumpMap,
      bumpScale: source.bumpScale,
      normalMap: source.normalMap,
      normalScale: source.normalScale,
      displacementMap: source.displacementMap,
      displacementScale: source.displacementScale,
      displacementBias: source.displacementBias,
      roughness: THREE.MathUtils.clamp(source.roughness, 0.22, 0.3),
      roughnessMap: source.roughnessMap,
      metalness: 0,
      metalnessMap: source.metalnessMap,
      alphaMap: source.alphaMap,
      envMap: source.envMap,
      envMapIntensity: 1.08,
      transparent: source.transparent,
      opacity: source.opacity,
      alphaTest: source.alphaTest,
      side: source.side,
      depthTest: source.depthTest,
      depthWrite: source.depthWrite,
      clearcoat: 0.88,
      clearcoatRoughness: 0.16,
      ior: 1.48,
      specularIntensity: 0.9,
    });
    material.vertexColors = source.vertexColors;
    material.flatShading = source.flatShading;
    material.polygonOffset = source.polygonOffset;
    material.polygonOffsetFactor = source.polygonOffsetFactor;
    material.polygonOffsetUnits = source.polygonOffsetUnits;
    return material;
  }

  /** Clear-coated composite with broad reflections over the woven albedo. */
  private toPhysicalCarbon(source: THREE.MeshStandardMaterial): THREE.MeshPhysicalMaterial {
    const material = this.toPhysicalFairing(source);
    material.metalness = 0;
    material.roughness = 0.34;
    material.clearcoat = 0.62;
    material.clearcoatRoughness = 0.25;
    material.specularIntensity = 0.86;
    return material;
  }

  /** Brushed aluminium/steel uses directional highlights instead of mirror chrome. */
  private toPhysicalBrushedMetal(source: THREE.MeshStandardMaterial): THREE.MeshPhysicalMaterial {
    const material = this.toPhysicalFairing(source);
    material.metalness = 0.96;
    material.roughness = 0.29;
    material.clearcoat = 0;
    material.anisotropy = 0.62;
    material.anisotropyRotation = Math.PI * 0.5;
    return material;
  }

  /** Thin tinted windscreen/visor with reflective physically based transmission. */
  private toPhysicalGlass(source: THREE.MeshStandardMaterial): THREE.MeshPhysicalMaterial {
    const material = this.toPhysicalFairing(source);
    material.metalness = 0;
    material.roughness = 0.09;
    material.clearcoat = 0.35;
    material.clearcoatRoughness = 0.08;
    material.transmission = 0.52;
    material.thickness = 0.012;
    material.ior = 1.5;
    material.specularIntensity = 1;
    material.transparent = true;
    material.opacity = Math.min(source.opacity, 0.78);
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    return material;
  }

  /** Baked racing leather: diffuse cloth sheen plus a subtle helmet/glove coat. */
  private toPhysicalRider(source: THREE.MeshStandardMaterial): THREE.MeshPhysicalMaterial {
    const material = this.toPhysicalFairing(source);
    material.metalness = 0;
    material.color.set(0xffffff);
    material.roughness = 0.48;
    material.clearcoat = 0.06;
    material.clearcoatRoughness = 0.42;
    material.sheen = 0.34;
    material.sheenRoughness = 0.72;
    material.sheenColor.set(0x8d1827);
    material.specularIntensity = 0.62;
    return material;
  }

  /**
   * Build the VehicleConstraint from config values. Extracted so rebuild() can
   * recreate it after tuning changes — lean params are settings-only (they must be
   * set on MotorcycleControllerSettings BEFORE the VehicleConstraint is built).
   */
  private buildConstraint(body: Body): VehicleConstraint {
    const { Jolt } = this.world;

    const vehicle = new Jolt.VehicleConstraintSettings();
    vehicle.mUp = new Jolt.Vec3(0, 1, 0);
    vehicle.mForward = new Jolt.Vec3(0, 0, 1);
    vehicle.mMaxPitchRollAngle = 48 * DEG;

    // Wheels: front steerable with a caster-tilted suspension axis.
    const casterTan = Math.tan(WHEELS.casterAngleDeg * DEG);
    for (const isFront of [true, false]) {
      const ws = new Jolt.WheelSettingsWV();
      ws.mPosition = new Jolt.Vec3(0, WHEELS.attachY, isFront ? WHEELS.zFront : WHEELS.zRear);
      ws.mRadius = WHEELS.radius;
      ws.mWidth = WHEELS.width;
      if (isFront) {
        const dir = new Jolt.Vec3(0, -1, casterTan).Normalized();
        ws.mSuspensionDirection = dir;
        // Jolt's motorcycle sample uses the opposite of the suspension
        // direction as the steering axis.
        ws.mSteeringAxis = new Jolt.Vec3(0, 1, -casterTan).Normalized();
      } else {
        ws.mSuspensionDirection = new Jolt.Vec3(0, -1, 0);
      }
      const spring = new Jolt.SpringSettings();
      spring.mMode = Jolt.ESpringMode_FrequencyAndDamping;
      spring.mFrequency = isFront
        ? WHEELS.suspensionFrequencyHzFront
        : WHEELS.suspensionFrequencyHzRear;
      spring.mDamping = WHEELS.suspensionDamping;
      ws.mSuspensionSpring = spring;
      ws.mSuspensionMinLength = WHEELS.suspensionMinLength;
      ws.mSuspensionMaxLength = WHEELS.suspensionMaxLength;
      ws.mInertia = WHEELS.inertia;
      ws.mAngularDamping = WHEELS.angularDamping;
      // Only the front wheel steers. This used to be assigned after the rear
      // zero above and accidentally gave both wheels 24 degrees of lock.
      ws.mMaxSteerAngle = isFront ? STEERING.maxSteerAngleDeg * DEG : 0;
      ws.mMaxBrakeTorque = isFront ? WHEELS.brakeTorqueFront : WHEELS.brakeTorqueRear;
      ws.mMaxHandBrakeTorque = 0;
      for (const [x, y] of TYRES.longitudinalCurve) ws.mLongitudinalFriction.AddPoint(x, y);
      for (const [x, y] of TYRES.lateralCurve) ws.mLateralFriction.AddPoint(x, y);
      vehicle.mWheels.push_back(ws);
    }

    // Motorcycle controller: lean spring + engine + transmission.
    const cs = new Jolt.MotorcycleControllerSettings();
    cs.mEngine.mMaxTorque = ENGINE.maxTorque;
    cs.mEngine.mMinRPM = ENGINE.minRpm;
    cs.mEngine.mMaxRPM = ENGINE.maxRpm;
    for (const [x, y] of ENGINE.normalizedTorqueCurve) {
      cs.mEngine.mNormalizedTorque.AddPoint(x, y);
    }
    // The generic Jolt automatic selects neutral when drive input is released.
    // A race bike instead holds its road gear, so selection is managed by the
    // deterministic AutomaticGearbox and applied through Jolt's manual mode.
    cs.mTransmission.mMode = Jolt.ETransmissionMode_Manual;
    for (const r of TRANSMISSION.gearRatios) cs.mTransmission.mGearRatios.push_back(r);
    cs.mTransmission.mShiftUpRPM = TRANSMISSION.shiftUpRpm;
    cs.mTransmission.mShiftDownRPM = TRANSMISSION.shiftDownRpm;
    cs.mTransmission.mClutchStrength = TRANSMISSION.clutchStrength;

    const diff = new Jolt.VehicleDifferentialSettings();
    diff.mLeftWheel = DIFFERENTIAL.leftWheelIndex;
    diff.mRightWheel = DIFFERENTIAL.rightWheelIndex;
    diff.mDifferentialRatio = DIFFERENTIAL.ratio;
    diff.mLimitedSlipRatio = DIFFERENTIAL.limitedSlipRatio;
    cs.mDifferentials.push_back(diff);

    cs.mMaxLeanAngle = LEAN.maxLeanAngleDeg * DEG;
    cs.mLeanSpringConstant = LEAN.springConstant;
    cs.mLeanSpringDamping = LEAN.springDamping;
    cs.mLeanSpringIntegrationCoefficient = LEAN.integrationCoefficient;
    cs.mLeanSpringIntegrationCoefficientDecay = LEAN.integrationCoefficientDecay;
    cs.mLeanSmoothingFactor = LEAN.smoothingFactor;
    vehicle.mController = cs;

    const constraint = new Jolt.VehicleConstraint(body, vehicle);
    const tester = new Jolt.VehicleCollisionTesterCastCylinder(LAYER_MOVING, 1);
    constraint.SetVehicleCollisionTester(tester);
    // cs/ws/spring/vehicle/tester all stay alive — see jolt.ts memory rules.

    return constraint;
  }

  private addStepListener(): void {
    this.stepListener = new this.Jolt.VehicleConstraintStepListener(this.constraint);
    this.world.physicsSystem.AddStepListener(this.stepListener);
  }

  /**
   * Destroy and rebuild the constraint (dev key T) — the only way to retune lean
   * parameters at runtime after editing config.ts (HMR-friendly tuning loop).
   */
  rebuild(): void {
    const { Jolt, physicsSystem, bodyInterface } = this.world;
    this.restoreRiderAfterCrash();
    if (this.stepListener && this.vehicleConstraintAttached) physicsSystem.RemoveStepListener(this.stepListener);
    if (this.vehicleConstraintAttached) physicsSystem.RemoveConstraint(this.constraint);
    // The old constraint is intentionally NOT destroyed — same binding rule as
    // creation chains (jolt.ts). Dev-only path; the leak is bounded by presses.
    bodyInterface.ActivateBody(this.bodyId);
    this.constraint = this.buildConstraint(this.body);
    physicsSystem.AddConstraint(this.constraint);
    this.addStepListener();
    this.vehicleConstraintAttached = true;
    this.controller = Jolt.castObject(this.constraint.GetController(), Jolt.MotorcycleController);
    this.telemetry.crashed = false;
    this.telemetry.impactSeverity = 0;
    this.crashDetector.reset();
    this.applyGearboxReset();
    this.captureWheelState();
  }

  /** Called once per fixed step, BEFORE world.step(). */
  prePhysicsUpdate(dt: number, intent: InputIntent): void {
    const { bodyInterface, scratch } = this.world;
    const { vec3 } = scratch;

    if (this.telemetry.crashed) {
      // Crash entry clears the controller once. Do not feed steering, drive,
      // lean-helper, brake, or anti-wheelie forces into the incident.
      return;
    }

    // Keyboard/gamepad input is shaped and progressively capped with speed.
    // Jolt then applies its physics-derived speed/lean steering limit as a
    // second safety layer inside MotorcycleController::PreCollide.
    const speedKph = Math.abs(this.forwardSpeed) * 3.6;
    const speedScale = sampleCurve(STEERING.speedInputScale, speedKph);
    const steerTarget =
      Math.sign(intent.steer) * Math.pow(Math.abs(intent.steer), STEERING.inputExponent) * speedScale;
    // Controls already applies a timestep-independent steering ramp. Applying
    // a second ramp here made keyboard steering feel delayed and unresponsive.
    const brakingStability =
      1 - THREE.MathUtils.smoothstep(speedKph, 40, 180) * intent.brake * 0.35;
    this.steerCurrent = steerTarget * brakingStability;

    // MotoGP control: S/Down is always a brake. There is no reverse gear and
    // braking at rest must never command negative drive torque.
    let forward = intent.throttle;
    let brake = intent.brake;

    const shift = this.gearbox.update(dt, Math.abs(this.forwardSpeed), forward);
    this.controller.GetTransmission().Set(
      shift.gear,
      shift.clutch * TRANSMISSION.clutchStrength,
    );
    forward *= shift.driveScale;

    // As in Jolt's official motorcycle sample, reduce braking while leaned so
    // a cornering brake tap does not instantly spin the bike around.
    if (brake > 0) {
      const sinLean = Math.sin(Math.min(89, Math.abs(this.telemetry.leanDeg)) * DEG);
      brake *= Math.max(0.12, (1 - sinLean) ** 2);
    }

    // Anti-wheelie traction control: once the rear is planted and the front
    // lifts, progressively cut drive instead of letting engine torque rotate
    // the entire chassis around the rear axle.
    if (!this.telemetry.wheelContacts[0] && this.telemetry.wheelContacts[1] && forward > 0) {
      forward *= 0.22;
    }
    this.controller.SetDriverInput(forward, this.steerCurrent, brake, 0);

    // Active pitch damper, only while the front wheel is airborne. It permits
    // road crests but arrests a power wheelie before rider/bike leave the road
    // plane. Torque is applied about the bike's world-space right axis.
    if (!this.telemetry.wheelContacts[0] && this.telemetry.wheelContacts[1]) {
      bodyInterface.GetPositionAndRotation(this.bodyId, scratch.rvec3, scratch.quat);
      const q = scratch.quat;
      const qx = q.GetX(), qy = q.GetY(), qz = q.GetZ(), qw = q.GetW();
      const rightX = 1 - 2 * (qy * qy + qz * qz);
      const rightY = 2 * (qx * qy + qw * qz);
      const rightZ = 2 * (qx * qz - qw * qy);
      const forwardY = 2 * (qy * qz - qw * qx);
      // Body::GetAngularVelocity returns a borrowed accessor into the body.
      // Never destroy it: doing so frees WASM-owned memory and causes the
      // delayed `memory access out of bounds` crash seen under throttle.
      const angularVelocity = this.body.GetAngularVelocity();
      const pitchRate =
        angularVelocity.GetX() * rightX +
        angularVelocity.GetY() * rightY +
        angularVelocity.GetZ() * rightZ;
      const liftError = Math.max(0, forwardY - Math.sin(8 * DEG));
      const torque = THREE.MathUtils.clamp(liftError * 6200 - pitchRate * 950, -2400, 6200);
      vec3.Set(rightX * torque, rightY * torque, rightZ * torque);
      bodyInterface.AddTorque(this.bodyId, vec3, this.Jolt.EActivation_DontActivate);
    }

    // Aerodynamic drag + downforce (forces reset after each Step).
    const speedSq = this.forwardSpeed * this.forwardSpeed;
    if (speedSq > 1) {
      this.getForwardInto(this.fwdTmp);
      const dragMag = AERO.dragK * speedSq;
      vec3.Set(-this.fwdTmp.x * dragMag, -this.fwdTmp.y * dragMag, -this.fwdTmp.z * dragMag);
      bodyInterface.AddForce(this.bodyId, vec3, this.Jolt.EActivation_DontActivate);
      vec3.Set(0, -AERO.downforceK * speedSq, 0);
      bodyInterface.AddForce(this.bodyId, vec3, this.Jolt.EActivation_DontActivate);
    }

    if (forward !== 0 || brake !== 0 || Math.abs(this.steerCurrent) > 0.01) {
      bodyInterface.ActivateBody(this.bodyId);
    }
  }

  /** Called once per fixed step, AFTER world.step(). Snapshots telemetry. */
  postPhysicsUpdate(dt: number): CrashEvent | null {
    const { bodyInterface, scratch } = this.world;
    const { quat, rvec3 } = scratch;

    const vel = bodyInterface.GetLinearVelocity(this.bodyId); // allocating getter
    const vx = vel.GetX();
    const vy = vel.GetY();
    const vz = vel.GetZ();
    this.getForwardInto(this.fwdTmp);
    this.forwardSpeed =
      vx * this.fwdTmp.x + vy * this.fwdTmp.y + vz * this.fwdTmp.z;
    // Horizontal ground speed excludes suspension bounce, kerb launches, and
    // sinking/recovery motion that used to make the speedometer jump.
    this.telemetry.speedKph = Math.hypot(vx, vz) * 3.6;
    const deltaVelocity = this.hasPreviousVelocity
      ? Math.hypot(vx - this.previousVelocity.x, vy - this.previousVelocity.y, vz - this.previousVelocity.z)
      : 0;
    this.previousVelocity.set(vx, vy, vz);
    this.hasPreviousVelocity = true;
    this.Jolt.destroy(vel);

    bodyInterface.GetPositionAndRotation(this.bodyId, rvec3, quat);
    if (this.hasPhysicsPose) {
      this.posePreviousPosition.copy(this.poseCurrentPosition);
      this.posePreviousQuaternion.copy(this.poseCurrentQuaternion);
    }
    this.poseCurrentPosition.set(rvec3.GetX(), rvec3.GetY(), rvec3.GetZ());
    this.poseCurrentQuaternion.set(quat.GetX(), quat.GetY(), quat.GetZ(), quat.GetW());
    if (!this.hasPhysicsPose) {
      this.posePreviousPosition.copy(this.poseCurrentPosition);
      this.posePreviousQuaternion.copy(this.poseCurrentQuaternion);
      this.hasPhysicsPose = true;
    }
    this.telemetry.leanDeg = computeLean(quat);
    if (this.vehicleConstraintAttached) {
      this.telemetry.rpm = this.controller.GetEngine().GetCurrentRPM();
      this.captureWheelState();
    } else {
      this.telemetry.wheelContacts[0] = false;
      this.telemetry.wheelContacts[1] = false;
      this.telemetry.rpm = Math.max(ENGINE.minRpm, this.telemetry.rpm - dt * 4000);
    }
    this.telemetry.gear = this.gearbox.gear;

    if (this.telemetry.crashed) return null;
    const qx = quat.GetX(), qz = quat.GetZ();
    const uprightDot = 1 - 2 * (qx * qx + qz * qz);
    // Body::GetAngularVelocity is a borrowed accessor; never destroy it.
    const angular = this.body.GetAngularVelocity();
    const angularSpeed = Math.hypot(angular.GetX(), angular.GetY(), angular.GetZ());
    const crash = this.crashDetector.update({
      speedMps: this.telemetry.speedKph / 3.6,
      deltaVelocityMps: deltaVelocity,
      uprightDot,
      angularSpeedRad: angularSpeed,
      frontContact: this.telemetry.wheelContacts[0]!,
      rearContact: this.telemetry.wheelContacts[1]!,
    });
    if (!crash) {
      this.telemetry.impactSeverity = Math.max(0, this.telemetry.impactSeverity - dt * 2);
      return null;
    }
    this.beginCrash(crash.severity);
    return crash;
  }

  /** Copy body transform onto the visual group; place/spin/steer the wheel meshes. */
  syncVisuals(interpolationAlpha = 1): void {
    if (this.hasPhysicsPose) {
      const alpha = THREE.MathUtils.clamp(interpolationAlpha, 0, 1);
      this.root.position.lerpVectors(this.posePreviousPosition, this.poseCurrentPosition, alpha);
      this.root.quaternion.slerpQuaternions(
        this.posePreviousQuaternion,
        this.poseCurrentQuaternion,
        alpha,
      );
    } else {
      const { bodyInterface, scratch } = this.world;
      bodyInterface.GetPositionAndRotation(this.bodyId, scratch.rvec3, scratch.quat);
      this.root.position.set(scratch.rvec3.GetX(), scratch.rvec3.GetY(), scratch.rvec3.GetZ());
      this.root.quaternion.set(
        scratch.quat.GetX(),
        scratch.quat.GetY(),
        scratch.quat.GetZ(),
        scratch.quat.GetW(),
      );
    }

    for (const [i, mesh] of this.wheelMeshes.entries()) {
      const suspLen = this.wheelSuspensionLength[i] ?? WHEELS.suspensionMaxLength;
      const isFront = i === 0;
      // Suspension travel along the (castered) suspension direction.
      let dy = -suspLen;
      let dz = 0;
      if (isFront) {
        const invLen = 1 / Math.hypot(1, Math.tan(WHEELS.casterAngleDeg * DEG));
        dy = -suspLen * invLen;
        dz = suspLen * Math.tan(WHEELS.casterAngleDeg * DEG) * invLen;
      }
      mesh.position.set(0, WHEELS.attachY + dy, (isFront ? WHEELS.zFront : WHEELS.zRear) + dz);
      mesh.rotation.set(
        this.wheelRotationAngle[i] ?? 0,
        isFront ? (this.wheelSteerAngle[i] ?? 0) : 0,
        0,
        'YXZ', // spin about X applied in the steered frame
      );
    }

    this.syncCrashedRider();
  }

  /** Upright reset at a sampled road point, heading yawRad, zero velocity. */
  respawnAt(x: number, roadY: number, z: number, yawRad: number): void {
    const { Jolt, bodyInterface } = this.world;
    this.restoreRiderAfterCrash();
    this.attachVehicleConstraint();
    const pos = new Jolt.RVec3(x, roadY + SPAWN_Y, z);
    // sRotation returns a shared-slot alias — consume inline, never destroy.
    const yawQ = Jolt.Quat.prototype.sRotation(new Jolt.Vec3(0, 1, 0), yawRad);
    const zero = new Jolt.Vec3(0, 0, 0);
    bodyInterface.SetPositionRotationAndVelocity(this.bodyId, pos, yawQ, zero, zero);
    bodyInterface.ActivateBody(this.bodyId);
    Jolt.destroy(pos);
    Jolt.destroy(zero);
    this.steerCurrent = 0;
    this.telemetry.crashed = false;
    this.telemetry.impactSeverity = 0;
    this.crashDetector.reset();
    this.hasPreviousVelocity = false;
    this.hasPhysicsPose = false;
    this.applyGearboxReset();
  }

  /** Enter the same physical rider-ejection crash used for hard impacts. */
  forceCrash(severity = 0.8): boolean {
    if (this.telemetry.crashed) return false;
    this.beginCrash(THREE.MathUtils.clamp(severity, 0, 1));
    return true;
  }

  /** World-space rider position for the cinematic crash camera. */
  getCrashRiderPositionInto(target: THREE.Vector3): boolean {
    if (!this.riderCrashBodyId) return false;
    this.world.bodyInterface.GetPositionAndRotation(
      this.riderCrashBodyId,
      this.world.scratch.rvec3,
      this.world.scratch.quat,
    );
    target.set(
      this.world.scratch.rvec3.GetX(),
      this.world.scratch.rvec3.GetY(),
      this.world.scratch.rvec3.GetZ(),
    );
    return true;
  }

  /** Reset always returns to first gear; a running motorcycle never auto-selects neutral. */
  private applyGearboxReset(): void {
    const command = this.gearbox.reset();
    this.controller.GetTransmission().Set(
      command.gear,
      command.clutch * TRANSMISSION.clutchStrength,
    );
    this.controller.GetEngine().SetCurrentRPM(ENGINE.minRpm);
    this.telemetry.gear = command.gear;
    this.telemetry.rpm = ENGINE.minRpm;
  }

  /**
   * World-space forward direction into a plain {x,y,z} target — accepts
   * THREE.Vector3. Allocation-free via the out-param API.
   */
  getForwardInto(target: { x: number; y: number; z: number }): void {
    const { bodyInterface, scratch } = this.world;
    bodyInterface.GetPositionAndRotation(this.bodyId, scratch.rvec3, scratch.quat);
    const q = scratch.quat;
    const x = q.GetX(), y = q.GetY(), z = q.GetZ(), w = q.GetW();
    target.x = 2 * (x * z + w * y);
    target.y = 2 * (y * z - w * x);
    target.z = 1 - 2 * (x * x + y * y);
  }

  /**
   * Read the authoritative fixed-step body pose without waiting for the next
   * rendered frame. Returns world-up dot bike-up: +1 upright, -1 inverted.
   */
  getPhysicsPoseInto(
    position: { x: number; y: number; z: number },
    forward: { x: number; y: number; z: number },
  ): number {
    const { bodyInterface, scratch } = this.world;
    bodyInterface.GetPositionAndRotation(this.bodyId, scratch.rvec3, scratch.quat);
    const p = scratch.rvec3;
    const q = scratch.quat;
    position.x = p.GetX();
    position.y = p.GetY();
    position.z = p.GetZ();
    const x = q.GetX(), y = q.GetY(), z = q.GetZ(), w = q.GetW();
    forward.x = 2 * (x * z + w * y);
    forward.y = 2 * (y * z - w * x);
    forward.z = 1 - 2 * (x * x + y * y);
    return 1 - 2 * (x * x + z * z);
  }

  dispose(): void {
    const { physicsSystem } = this.world;
    this.restoreRiderAfterCrash();
    this.leatherMicroMap?.dispose();
    this.carbonMicroMap?.dispose();
    for (const resource of this.liveryResources) resource.dispose();
    if (this.stepListener && this.vehicleConstraintAttached) physicsSystem.RemoveStepListener(this.stepListener);
    if (this.vehicleConstraintAttached) physicsSystem.RemoveConstraint(this.constraint);
    this.world.destroyBody(this.bodyId);
  }

  private beginCrash(severity: number): void {
    this.telemetry.crashed = true;
    this.telemetry.impactSeverity = severity;
    // Keep the constraint and its native step listener registered. Removing a
    // live VehicleConstraintStepListener from the wasm-compat binding leaves a
    // stale native callback that fails as `null function` on the next Step().
    // Neutral input lets the chassis continue as an unpowered physical bike,
    // while the rider is ejected into the separate capsule below.
    this.controller.SetDriverInput(0, 0, 0, 0);
    if (!this.riderVisual || !this.root.parent) return;

    this.root.updateMatrixWorld(true);
    const visualWorld = this.riderVisual.matrixWorld.clone();
    const bounds = new THREE.Box3().setFromObject(this.riderVisual);
    const center = bounds.getCenter(this.crashCenter);
    const rotation = this.riderVisual.getWorldQuaternion(this.crashRotation);

    this.root.parent.attach(this.riderVisual);
    this.riderVisual.visible = true;
    if (this.riderCockpitHands) this.riderCockpitHands.visible = false;
    if (this.riderCockpitArms) this.riderCockpitArms.visible = false;

    this.crashBodyMatrix.compose(center, rotation, this.crashScale);
    this.riderCrashRelative.copy(this.crashBodyMatrix).invert().multiply(visualWorld);

    const bikeVelocity = this.world.bodyInterface.GetLinearVelocity(this.bodyId);
    const bikeAngular = this.body.GetAngularVelocity();
    this.getForwardInto(this.fwdTmp);
    this.riderCrashBodyId = this.world.addDynamicCapsule(
      CRASH.riderCapsuleHalfHeight,
      CRASH.riderCapsuleRadius,
      center,
      rotation,
      CRASH.riderMassKg,
      {
        friction: CRASH.riderFriction,
        restitution: CRASH.riderRestitution,
        linearVelocity: {
          x: bikeVelocity.GetX() + this.fwdTmp.z * severity * 1.6,
          y: bikeVelocity.GetY() + 1.2 + severity * 1.8,
          z: bikeVelocity.GetZ() - this.fwdTmp.x * severity * 1.6,
        },
        angularVelocity: {
          x: bikeAngular.GetX() + 2.5 + severity * 3.5,
          y: bikeAngular.GetY() + 1.2 * severity,
          z: bikeAngular.GetZ() + 2 + severity * 2.5,
        },
      },
    );
    this.Jolt.destroy(bikeVelocity);
  }

  private syncCrashedRider(): void {
    if (!this.riderCrashBodyId || !this.riderVisual?.parent) return;
    const { bodyInterface, scratch } = this.world;
    bodyInterface.GetPositionAndRotation(this.riderCrashBodyId, scratch.rvec3, scratch.quat);
    this.crashCenter.set(scratch.rvec3.GetX(), scratch.rvec3.GetY(), scratch.rvec3.GetZ());
    this.crashRotation.set(
      scratch.quat.GetX(),
      scratch.quat.GetY(),
      scratch.quat.GetZ(),
      scratch.quat.GetW(),
    );
    this.crashBodyMatrix.compose(this.crashCenter, this.crashRotation, this.crashScale);
    this.crashWorldMatrix.copy(this.crashBodyMatrix).multiply(this.riderCrashRelative);
    this.crashParentInverse.copy(this.riderVisual.parent.matrixWorld).invert();
    this.crashWorldMatrix.premultiply(this.crashParentInverse);
    this.crashWorldMatrix.decompose(
      this.riderVisual.position,
      this.riderVisual.quaternion,
      this.riderVisual.scale,
    );
  }

  private restoreRiderAfterCrash(): void {
    if (this.riderCrashBodyId) {
      this.world.destroyBody(this.riderCrashBodyId);
      this.riderCrashBodyId = null;
    }
    if (this.riderVisual && this.riderHomeParent) {
      this.riderHomeParent.add(this.riderVisual);
      this.riderVisual.position.copy(this.riderHomePosition);
      this.riderVisual.quaternion.copy(this.riderHomeQuaternion);
      this.riderVisual.scale.copy(this.riderHomeScale);
      this.riderVisual.visible = this.riderVisible;
    }
    if (this.riderCockpitArms) this.riderCockpitArms.visible = !this.riderVisible;
    if (this.riderCockpitHands) {
      this.riderCockpitHands.visible = !this.riderVisible && this.riderCockpitArms === null;
    }
  }

  private attachVehicleConstraint(): void {
    if (this.vehicleConstraintAttached) return;
    this.world.physicsSystem.AddConstraint(this.constraint);
    if (this.stepListener) this.world.physicsSystem.AddStepListener(this.stepListener);
    this.vehicleConstraintAttached = true;
  }

  /** Copy borrowed wheel data while the constraint is known to be attached. */
  private captureWheelState(): void {
    if (!this.vehicleConstraintAttached) return;
    for (let i = 0; i < this.wheelSuspensionLength.length; i++) {
      const wheel = this.constraint.GetWheel(i);
      this.wheelSuspensionLength[i] = wheel.GetSuspensionLength();
      this.wheelRotationAngle[i] = wheel.GetRotationAngle();
      this.wheelSteerAngle[i] = wheel.GetSteerAngle();
      this.telemetry.wheelContacts[i] = wheel.HasContact();
    }
  }

  /** Low-poly fallback shown only if the authored Ducati GLB fails to load. */
  private buildPlaceholderVisuals(): void {
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xd81e2c, metalness: 0.3, roughness: 0.4 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x16181d, roughness: 0.7 });

    const fairing = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.42, 1.3), bodyMat);
    fairing.position.set(0, 0.05, 0.15);
    fairing.castShadow = true;
    this.placeholderBody.add(fairing);

    const rider = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.4, 4, 8), darkMat);
    rider.position.set(0, 0.45, -0.25);
    rider.rotation.x = 1.0; // tuck
    rider.castShadow = true;
    this.placeholderBody.add(rider);
    this.root.add(this.placeholderBody);

    const tyreMat = new THREE.MeshStandardMaterial({ color: 0x08090c, roughness: 0.84, metalness: 0.02 });
    const rimMat = new THREE.MeshStandardMaterial({ color: 0x1d2836, roughness: 0.24, metalness: 0.94 });
    const rotorMat = new THREE.MeshStandardMaterial({ color: 0xaab4be, roughness: 0.28, metalness: 0.9 });
    const hubMat = new THREE.MeshStandardMaterial({ color: 0xc92430, roughness: 0.2, metalness: 0.52 });
    const tyreGeo = new THREE.CylinderGeometry(WHEELS.radius, WHEELS.radius * 0.97, WHEELS.width, 28, 2);
    tyreGeo.rotateZ(-Math.PI / 2); // cylinder axis Y → axle along X
    const rimGeo = new THREE.CylinderGeometry(WHEELS.radius * 0.66, WHEELS.radius * 0.66, WHEELS.width * 1.14, 24, 1);
    rimGeo.rotateZ(-Math.PI / 2);
    const rotorGeo = new THREE.CylinderGeometry(WHEELS.radius * 0.54, WHEELS.radius * 0.54, 0.012, 24, 1);
    rotorGeo.rotateZ(-Math.PI / 2);
    const hubGeo = new THREE.CylinderGeometry(WHEELS.radius * 0.18, WHEELS.radius * 0.18, WHEELS.width * 1.28, 16, 1);
    hubGeo.rotateZ(-Math.PI / 2);
    for (const isFront of [true, false]) {
      const wheel = new THREE.Group();
      const tyre = new THREE.Mesh(tyreGeo, tyreMat);
      tyre.castShadow = true;
      tyre.receiveShadow = true;
      const rim = new THREE.Mesh(rimGeo, rimMat);
      const hub = new THREE.Mesh(hubGeo, hubMat);
      const leftRotor = new THREE.Mesh(rotorGeo, rotorMat);
      leftRotor.position.x = -WHEELS.width * 0.63;
      const rightRotor = new THREE.Mesh(rotorGeo, rotorMat);
      rightRotor.position.x = WHEELS.width * 0.63;
      wheel.add(tyre, rim, hub, leftRotor, rightRotor);
      wheel.position.set(0, WHEELS.attachY, isFront ? WHEELS.zFront : WHEELS.zRear);
      this.wheelMeshes.push(wheel);
      this.root.add(wheel);
    }
  }

}

/** Signed lean angle (deg) of a body rotation about its forward axis; positive = right. */
function computeLean(q: InstanceType<JoltModule['Quat']>): number {
  const x = q.GetX(), y = q.GetY(), z = q.GetZ(), w = q.GetW();
  // Body-up = q * (0,1,0)
  const ux = 2 * (x * y + w * z);
  const uy = 1 - 2 * (x * x + z * z);
  const uz = 2 * (y * z - w * x);
  // Horizontal forward = flatten(q * (0,0,1)); world-right = cross(up, fwdHoriz)
  const fx = 2 * (x * z + w * y);
  const fz = 1 - 2 * (x * x + y * y);
  const len = Math.hypot(fx, fz) || 1e-6;
  const rx = fz / len;
  const rz = -fx / len;
  return Math.atan2(ux * rx + uz * rz, uy) / DEG;
}

function sampleCurve(points: ReadonlyArray<readonly [number, number]>, x: number): number {
  if (x <= points[0]![0]) return points[0]![1];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i]!;
    if (x > x1) continue;
    const [x0, y0] = points[i - 1]!;
    const t = (x - x0) / Math.max(1e-6, x1 - x0);
    return y0 + (y1 - y0) * t;
  }
  return points[points.length - 1]![1];
}
