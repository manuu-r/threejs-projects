# Prototype cockpit: simulation notes

This is an independent, unbadged educational driving experience. Its vehicle geometry is an original reconstruction informed by visual references. Its control mappings and numerical settings are simulation choices, rather than operating instructions or measured specifications for a production vehicle.

## The simple experience

Choose **Start driving** to sit in the cockpit with assistance already configured. W accelerates, S brakes, and A/D steers. Arrow keys provide the same inputs. Space supplies a burst of rear thrust while held on the ground. Releasing Space ends the force; momentum continues until braking, drag and rolling resistance remove it.

Slow below approximately 20 km/h and press H for a brief assisted lift. A height controller aims for roughly 1.15 metres above the resting position, while an attitude controller keeps the body stable. W/S asks for forward/backward motion and A/D asks for a turn. The experience automatically commands landing after about 2.5 seconds or earlier when descent reserve is needed. H can also command landing sooner. Rear thrust is inhibited during this beginner flight sequence.

A finite gas reservoir supplies the impulse. It is not replenished during a drive. R deliberately starts a fresh scenario with repaired body state and a full reservoir. Resetting is a convenience of the simulator, rather than a simulation of an onboard compressor.

**Take a cockpit ride** is a scripted demonstration using the same rigid-body physics. It launches and brakes, then explicitly begins a separate hover exercise with a fresh reservoir. The camera stays in the seat and control becomes available when the demonstration ends.

The Lessons menu exposes the detailed training controls. Configuration, arming, fan settings and manual flight inputs are available there. These are optional; the main drive does not require learning the full instrument panel.

## Why gas creates thrust

Gas leaving a nozzle carries momentum away. The vehicle receives an opposing force. A useful approximation is **F = mass-flow rate × effective exhaust velocity**. The general thrust equation also includes pressure acting at the nozzle exit. An effective exhaust velocity can combine these terms for a simplified model.

Impulse is accumulated force over time: **J = integral of F dt**. In a short interval without other forces, velocity changes by approximately **delta-v = J / mass**. A force does not directly set speed, and stopping a jet does not instantly stop the car. The simulation applies the forces to a rigid body and lets its resulting linear and angular momentum evolve.

For an analytical example, a 1,800 kg object receiving 18,000 N for 0.30 seconds gets 5,400 N·s of impulse. Ignoring drag and ground forces, its speed changes by 3 m/s, or 10.8 km/h. This is an arithmetic example, not a performance promise.

Cold-gas propulsion need not involve combustion. The game uses a diffuse pale plume rather than a flame. The visible plume is an illustrative particle effect, not a simulation of nozzle flow, condensation or exhaust temperature.

General source: [NASA Glenn, rocket thrust equation](https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/rocket-thrust-equation/).

## Finite reserve and pressure

The gas model tracks mass and total delivered impulse. Every impulse consumes mass according to the assumed effective exhaust velocity. Attitude correction spends reserve as well as lift and forward propulsion.

The reservoir uses an idealized adiabatic blowdown relation, **P/P0 = (m/m0)^gamma**. A simplified regulator preserves full force until pressure approaches its operating limit; authority then falls. Residual gas remains below the assumed useful cutoff, so the display reports usable impulse rather than treating every remaining kilogram as available thrust.

This does not include real-gas corrections, pipe and valve losses, heat transfer, detailed vessel construction, or a validated nozzle curve. The assumptions are exposed so the short endurance has a physical explanation.

General source: [NASA, small-spacecraft propulsion survey](https://www.nasa.gov/smallsat-institute/sst-soa/in-space_propulsion/).

## Weight, grip and stopping

Four raycast wheels transmit forces through an approximate suspension model. A rigid body supplies chassis motion, gravity, collision response and rotational inertia. The physics advances in fixed steps at 120 Hz.

Motor torque is limited by power and by combined tire grip. Steering and braking share the available tire-force budget. Wet conditions lower grip. Leaving the prepared runway also reduces available grip. The model uses approximate friction rather than measured tire curves.

Suction produces low-speed downforce in the ground configuration. A separate aerodynamic term grows with speed squared. Greater normal load can improve the modeled tire-force budget, but an airborne car has no tire contact to transmit steering or brake force to the ground. The fan's ground contribution fades with height and is disabled during flight.

Aerodynamic drag follows velocity relative to the wind. Drag, rolling resistance, braking and collision impulses remove momentum through their respective physical mechanisms. Crosswind remains meaningful after takeoff.

Braking distance changes strongly with entry speed. For an elementary constant-deceleration estimate, **distance = speed squared / (2 × deceleration)**. Doubling the initial speed therefore needs roughly four times the distance at the same deceleration. The braking lesson is designed to make that relationship visible.

## Balance in the air

A force through the centre of mass changes translation. A force applied with an offset also creates torque, according to **torque = position offset × force**. The flight controller uses local body axes so pitch, roll and yaw have consistent meanings even after the chassis rotates.

Assistance is a cascade: pilot requests set small lean or yaw targets; proportional and damping terms request torque; altitude error and vertical speed request lift. Gravity remains active at every step. As pressure and reserve decline, the controller loses authority rather than holding the car up by directly changing its position.

Manual lessons expose angular inertia and the need to counteract rotation. These mappings illustrate a control problem; they are not a reconstruction of a manufacturer's controller.

## Selected numerical assumptions

| Quantity | Simulation setting |
| --- | --- |
| Initial total mass | 1,800 kg |
| Dry mass / initial gas | 1,620 kg / 180 kg |
| Effective exhaust velocity | 650 m/s |
| Initial / useful cutoff pressure | 300 / 35 bar |
| Blowdown exponent | 1.4 |
| Nominal rear thrust | 22 kN |
| Maximum lift force | 33 kN |
| Initial usable impulse | Approximately 91.8 kN·s |
| Motor power / force cap | 720 kW / 18.5 kN |
| Low-speed fan downforce | 12.5 kN |
| Physics integration | 120 fixed steps per second |

These are teaching parameters. At the initial weight, the available impulse corresponds to roughly 5.2 seconds of ideal hover-equivalent impulse before pressure, maneuver and control effects. That estimate is not a flight-duration guarantee.

The assumed 180 kg reservoir is substantial. If modeled as ideal air at 293 K and 300 bar, **V = mRT/P** gives approximately 0.505 cubic metres, or 505 litres, before vessel walls, mounts and plumbing. No packaging feasibility or structural qualification is claimed for the visual vehicle.

## The view from the seat

The default camera is at an inferred seated eye position, with a 64-degree vertical field of view. Its acceleration response is smoothed, with small motion cues for longitudinal and lateral load. The moving yoke, suspension-following wheels, live mirror and dashboard provide scale and motion references.

The cabin uses a plain central control screen and an embedded speed display in simple mode. The extra attitude display appears in detailed training mode. Manufacturer badges, full vehicle names and decorative brand labels are absent from the public experience.

Drag to look around. C changes between the seat, exterior orbit and hood cameras; drag in exterior view to orbit. V recentres the view. Camera motion, field of view, audio and rendering quality can be adjusted in Settings.

## Scope and assets

The proving ground is fictional. The scenery and vehicle are original project geometry. Distant mountains are visual scenery; the runway, boundary barriers and nearby buildings provide the principal collision surfaces. The project does not model flexible-body crashes, detailed structural damage, human biomechanics, computational fluid dynamics or certified control envelopes.

The sky reflection map is [Kloofendal 48d Partly Cloudy (Pure Sky)](https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky), by Greg Zaal with sky edits by Jarod Guest, distributed by Poly Haven under [CC0](https://polyhaven.com/license). It is bundled locally. Instrument graphics and procedural sound are project-created. Private visual-study photographs are excluded from the published application.
