// Research-informed teaching assumptions, not Tesla specifications. SI units throughout.
export const SIM = Object.freeze({
  dt: 1 / 120, gravity: 9.81, dryMass: 1620, gasMass: 180,
  exhaustVelocity: 650, fullPressureBar: 300, minimumPressureBar: 35,
  gamma: 1.4, rearThrust: 22000, liftThrust: 33000,
  attitudeTorque: 7000, leverArm: 1.35,
  motorPower: 720000, motorForce: 18500, maxSpeed: 100,
  dragArea: 0.64, airDensity: 1.225, rollingCoefficient: 0.012,
  fanDownforce: 12500, wingAreaCoefficient: 1.8,
  wheelbase: 2.8, track: 1.72, tireRadius: 0.34,
  startZ: -500, runwayHalfWidth: 18, runwayHalfLength: 1500,
  heightAtRest: 0.595, maxTrainingAltitude: 12
});
export const variantNames = {performance:'Road', thrust:'Boost', rocket:'Flight'} as const;
