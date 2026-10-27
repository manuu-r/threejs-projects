# Roadster Lab: research and engineering notes

**Research date: 16 October 2026.** This document supports an independent educational simulation. It is not a Tesla manual, a vehicle qualification program, or evidence that a simulated maneuver is authorized in a real vehicle. References describe the public information available on the research date; calculations below are original illustrative examples.

## 1. What is known, and what is an interpretation?

The live [Tesla Roadster page](https://www.tesla.com/roadster), inspected in a browser on the research date, describes three configurations. **Performance** has two seats, active aerodynamics, and fan-generated suction. **Thrust** adds rear cold-gas propulsion and an advertised sub-one-second 0–60 mph capability. **Rocket** has one seat and perimeter thrusters for forward, upward, and rotational movement; Tesla states that it is not approved for public-road use. These are manufacturer descriptions, not independent performance measurements.

Tesla’s current interior material describes white upholstery, gray microsuede, a steer-by-wire yoke, a center touchscreen, two smaller forward displays, and a fixed seat position. Its page describes electrically actuated thrusters making rapid stabilizing adjustments. Exact flight control mappings, gas capacity, operating pressure, full thrust curves, and certified endurance are not established by the material reviewed. The simulator supplies those missing details as explicit design assumptions. [Tesla’s current page](https://www.tesla.com/roadster)

This matters because search engines still return the earlier red concept, four-seat descriptions, and older performance targets. The new white-car reference is the visual starting point here. The 2017 concept’s specifications must not be silently combined with the newly described configurations. Likewise, the Roadster carried as a payload on a Falcon Heavy demonstration is a different story from a vehicle producing its own local thrust.

A useful confidence hierarchy is: **manufacturer-published feature**, **general engineering principle**, **illustrative calculation**, then **simulator choice**. A convincing render cannot move the last category into the first. The game should make that distinction visible in its research panel and in lessons that introduce hypothetical airborne controls.

## 2. What a cold-gas system actually does

A cold-gas thruster releases pressurized working fluid through a nozzle. Its exhaust carries momentum in one direction and the vehicle receives momentum in the other. It need not burn fuel or produce the orange flame associated with a chemical rocket. NASA describes cold-gas propulsion as a mature, comparatively simple technology, useful for small, precise impulses but limited by its available total impulse. Nitrogen is common in spacecraft applications; that does **not** establish which fluid or exact hardware a Roadster uses. [NASA’s propulsion survey, Cold Gas section](https://www.nasa.gov/smallsat-institute/sst-soa/in-space_propulsion/)

Think of the hardware as a chain: storage vessel → isolation and control valves → distribution plumbing → nozzle → exhaust. A controller decides which valves open and for how long. A compressor, if provided, would have its own energy, heat, flow, and refill constraints; there is no free replenishment simply because the drivetrain is electric. Publicly reviewed material does not justify choosing a real refill time.

“Cold” distinguishes the propulsion method from combustion. It should not be understood as a guarantee that every component is at room temperature or that a high-speed gas jet is harmless. An expansion can cool the fluid, and the storage system has considerable mechanical energy. In the game, a pale pressure plume and a short rushing sound are therefore more appropriate teaching cues than a sustained fiery exhaust.

A composite overwrapped pressure vessel, or COPV, uses a pressure barrier with a fiber-composite overwrap. NASA’s primer explains why the weight advantage comes with distinctive design, manufacturing, inspection, and failure considerations. A simple cylinder graphic is enough to explain its role in the simulator; it cannot represent a validated vessel design. No tank fabrication instructions, charging procedures, or assumed real pressure rating are implied here. [NASA COPV primer](https://ntrs.nasa.gov/citations/20110008406)

## 3. Force, impulse, and why a short pulse matters

The relevant idealized thrust relationship is:

**F = ṁ vₑ + (pₑ − pₐ) Aₑ**

Here F is force in newtons, ṁ is exhaust mass flow in kilograms per second, vₑ is exhaust speed, pₑ and pₐ are exit and ambient pressures, and Aₑ is nozzle exit area. The pressure term is why a nozzle’s operating environment matters. NASA presents this generalized relation for propulsion; applying it to a cold-gas teaching model does not mean the Roadster contains a combustion chamber. [NASA Glenn: rocket thrust equation](https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/rocket-thrust-equation/)

The most useful driver-level distinction is between **force** and **impulse**. Force determines the instantaneous acceleration. Impulse accumulates force over time: **J = ∫F dt**. For an approximately constant pulse, J ≈ FΔt and the speed change is approximately Δv = J/m. A pulse is not a temporary speed bonus that disappears when the button is released. After the jet stops, the added momentum remains until braking, drag, tire forces, or another impulse removes it.

For an independent numerical example, imagine a 1,800 kg vehicle receiving 18,000 N for 0.30 s. The pulse supplies 5,400 N·s. Ignoring drag and other forces during that interval, it adds 3.0 m/s, or 10.8 km/h. A one-second application at the same force would add 36 km/h. These numbers demonstrate the relationship; they are **not Roadster specifications and need not equal the game’s final tuning**.

This leads directly to a lesson: small repeatable pulses are easier to judge than holding an unfamiliar thrust control. The student should observe speed before firing, pulse, release, and compare the resulting speed. The visual effect should end with valve closure, while the car’s physical state continues evolving.

## 4. How demanding is a sub-one-second launch?

Sixty miles per hour is approximately 26.82 m/s. Going from rest to that speed in 0.90 s requires an average longitudinal acceleration of about 29.8 m/s², or 3.04 g. A 1,800 kg analytical example would require roughly 53.6 kN of net forward force averaged over the interval. This is a force budget, not a reverse-engineered specification. Wheel torque, tire grip, downforce, thrust, aerodynamic resistance, changing mass, and the measurement method would all affect a real result.

The calculation explains why a conventional tire-only comparison can mislead. Tires must transmit force through their contact patches. A rearward exhaust can provide a forward reaction force directly to the body. But the total still obeys Newton’s laws, and the driver, seat, restraint, suspension, and structure still experience loads. “Beyond physics” is a marketing expression, not a different set of equations.

A training simulator should avoid making the quickest launch the first exercise. It should teach straight-ahead alignment, progressive throttle, stopping distance, and the difference between accelerating force and remaining speed before introducing additional thrust. A useful launch lesson includes a measured stopping task; merely crossing a speed threshold teaches only half the maneuver.

## 5. Storage, mass flow, and endurance

Specific impulse describes impulse delivered per unit propellant weight. With standard gravity g₀, **Isp = F/(ṁg₀)**; an effective exhaust velocity can be written **v_eff = Isp g₀**. This is a propulsion efficiency measure, not a promise that a vehicle can maintain thrust for Isp seconds. [NASA Glenn: specific impulse](https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/specific-impulse/)

Continue the analytical 18 kN example and assume an effective exhaust velocity of 600 m/s. The inferred mass flow is 30 kg/s. A half-second firing would use 15 kg of gas. At 600 m/s effective exhaust velocity, 30 kg of usable propellant represents about 18 kN·s of total impulse; it would support the example’s 18 kN force for only about one second. None of those values has been measured from Tesla hardware. The point is that a visually tiny jet may imply substantial flow when it is asked to move a car rather than a small satellite.

A real pressurized system can behave differently as storage empties. A regulated system may hold output approximately steady until it reaches a limit; an unregulated blowdown system tends to lose pressure and available thrust over time. Fluid temperature, usable residual pressure, line losses, and valve behavior complicate either model. Roadster Lab uses both normalized reserve and a pressure calculation from an explicitly assumed storage model. Its pressure reading is **simulated pressure**, not verified Tesla telemetry. The chosen numbers and their packaging implications are disclosed below.

Resetting an exercise restores the reservoir as an intentional game convenience. This is not a modeled compressor or a physical refill process, and gas never regenerates during a maneuver. A reserve warning creates a meaningful lesson: stop discretionary firing early enough to retain control margin and finish the maneuver.

## 6. Tires, fan suction, and aerodynamic downforce

On the ground, the tire must share a finite force budget between acceleration, braking, and turning. A conceptual friction-circle model expresses this as **√(F_long² + F_lat²) ≤ μN**. This is an explanatory approximation; real tires depend on slip, temperature, load, surface, construction, and many other variables. It explains why adding steering during maximum braking can exceed available grip, and why easing one input can restore control authority.

For an original example, a wheel set with 20 kN of total normal load and an assumed friction coefficient of 1.0 has a simple 20 kN horizontal budget. Asking for 16 kN of braking leaves about 12 kN for lateral force under the circle approximation, because √(20² − 16²) = 12. The rule is a budgeting aid, not a tire certification test.

A wing typically develops downforce that grows with dynamic pressure: **D ≈ ½ρv²C_LA**. Doubling speed roughly quadruples this contribution when the coefficient and flow conditions stay comparable. A fan-and-seal arrangement changes the problem by reducing pressure beneath the body. The first estimate is **D ≈ ΔpA**. A hypothetical 3 m² effective sealed area at a 5 kPa pressure difference gives 15 kN of downforce. This is an illustration, not a claim about Tesla’s fan or floor area.

The distinction helps the student understand why a fan can influence grip at low speed, while a wing needs airflow. It also explains why seal condition and distance from the surface matter. The simulator should fade ground suction when airborne instead of treating it as an unlimited force that sticks the vehicle to an invisible road. Neither extra normal load nor propulsion creates infinite grip.

## 7. Once airborne, steering and stopping become different tasks

Ground steering changes the orientation of tire forces. Once the tires leave the surface, turning the road wheels alone cannot provide the same horizontal steering force. Airborne motion requires an appropriate combination of thrust direction, body attitude, aerodynamic force, and gravity. The driver can rotate a vehicle without immediately changing its velocity vector; this is why an attitude indicator and a speed display answer different questions.

A force applied away from the center of mass also produces a moment: **τ = r × F**. A paired arrangement can create rotation with limited net translation, or translation with limited rotation, depending on placement and control allocation. A control mixer converts desired acceleration and attitude changes into individual actuator commands. Fast sensing and feedback are essential because a human does not reliably manage many independent nozzle pulses at stabilizing rates.

Hover is a force balance, not a special absence of gravity. For a level 1,800 kg analytical example, the upward force must equal about 17.7 kN merely to avoid accelerating vertically. If total thrust tilts 20° away from vertical, only T cos(20°) supports weight; maintaining altitude would require about 6.4% more total thrust than the level case. The tilted portion also accelerates the vehicle sideways. This creates a strong instructional reason to separate lift management from directional inputs.

An airborne vehicle continues drifting when a directional command is released. It must develop an opposing force to slow that drift. A gentle landing combines manageable horizontal speed, low vertical descent rate, suitable attitude, and sufficient remaining authority. A game can teach these relationships at low altitude and modest speed without claiming to reproduce a real Rocket flight envelope.

## 8. What the driver’s view should communicate

The official [interior reference image](https://digitalassets.tesla.com/tesla-contents/image/upload/f_auto,q_auto/Roadster-03-Carousel-Slide-4-Mobile.jpg) is photographed from behind the seating area. A driver-eye reconstruction must therefore infer dimensions, eye height, the visible amount of hood, screen legibility, and sight lines. A model can be visually informed by the photograph without being a dimensionally exact replica. The one-seat flight variant’s final production layout is not established by that photograph.

For the simulation, a plausible low eye point, visible windshield pillars, a shallow dashboard, and a moving yoke provide useful near-field reference. Surface texture, runway markings, cones, shadow motion, and distant terrain provide depth and motion cues. The view should retain enough road ahead to anticipate a maneuver; making the dashboard enormous may look dramatic but undermines learning.

Speed should be numerically unambiguous. Other instruments should answer concrete questions: Which mode is active? Are the jets armed? How much reserve remains? Am I climbing or descending? Are tires in contact? Am I requesting more grip than the tires can provide? Is an assistance function engaged? A bright plume is not a substitute for a clear armed-state indication.

Camera pitch and small vibration can imply acceleration, but a browser cannot reproduce vestibular acceleration, seat pressure, restraint load, or steering torque. Camera shake should be restrained and optional. A stable horizon and reduced-motion option support users who are sensitive to simulated movement. Realism comes from coherent physical feedback, not from maximizing screen movement.

## 9. A defensible hypothetical control scheme

No real flight-control manual was established by this research. Every keyboard, touch, controller, arming, and assistance mapping in Roadster Lab is therefore a **simulator interface**, even when the maneuver it teaches follows general mechanics.

The ground-driving abstraction should be familiar: throttle, service brake, left/right steering, reverse selection, and reset or recovery. A separate deliberate action arms the thruster system. Arming should change its status without itself applying thrust. Firing should consume reserve only while the corresponding command actually produces force. A mode change should explain which controls now have different meanings.

For airborne lessons, it is reasonable to teach an assisted mode first: vertical input requests climb or descent, directional inputs request small attitude or translational corrections, and a stabilization controller damps unwanted motion. The simulator should identify this assistance. A manual demonstration, if provided, can expose angular inertia and the need to counteract rotation. It should not imply that Tesla has chosen either of these user interfaces.

Recovery is another explicit abstraction. Resetting the vehicle onto a service pad is valuable for experimentation, but it must clear lingering force commands, velocities, lesson state when appropriate, and audio. Pausing should freeze the physical simulation rather than merely hide its view. Losing browser focus should release held inputs so the car cannot continue accelerating because a key-up event was missed.

## 10. Curriculum: teach one physical idea at a time

A useful sequence begins with cockpit orientation and basic controls. Students should identify the mode and speed, move off gently, follow a straight corridor, and stop. A braking exercise then makes stopping distance tangible. At a fixed deceleration, stopping distance grows with the square of speed; twice the entry speed can need approximately four times the braking distance before reaction time is considered.

The next exercise should combine steering with throttle restraint. A cone slalom teaches early small corrections and the cost of entering too fast. A fan-mode comparison can then make a change in grip observable under similar conditions. The score should reward clean completion and controlled speed, not encourage students to hit an arbitrary maximum in every lesson.

A thrust lesson can follow: arm, confirm alignment, apply a short pulse, release, observe the retained momentum, and stop in a marked region. A reserve lesson makes repeated firing and declining capacity visible. The student should receive immediate, specific feedback such as “release thrust before turning” or “slow down before the next gate,” rather than a generic failure sound.

Only after ground practice should an airborne lesson introduce lift balance, attitude, drift, reserve, and landing. The lesson should start with a small altitude target and no demand for a fast maneuver. A later free-practice mode can permit combinations. Completing a simulated lesson means its game criteria were met; it conveys no real driving or piloting qualification.

## 11. The implemented teaching model and its assumptions

The following values are the project’s selected simulation tuning, read from `src/config.ts` and `src/Physics.ts`. They are **not Tesla specifications**. The analytical 1,800 kg / 18 kN / 600 m/s examples above were chosen independently to make the arithmetic easy; the running simulation uses the values below.

| Quantity | Assumed simulation value | Meaning |
| --- | ---: | --- |
| Dry vehicle mass | 1,620 kg | All non-consumed vehicle mass, including hypothetical tank hardware |
| Initial gas mass | 180 kg | Initial total vehicle mass is 1,800 kg |
| Effective exhaust velocity | 650 m/s | About 66.3 s specific impulse |
| Initial / cutoff supply pressure | 300 / 35 bar | Assumed constant-volume reservoir; not an actual Roadster pressure rating |
| Adiabatic exponent | 1.4 | Simplified ideal-gas blowdown model |
| Regulator transition | 90 to 35 bar | Full nominal authority above 90 bar; linear pressure-based fade to cutoff |
| Rear thrust | 22 kN maximum | Two symmetric virtual rear jets |
| Vertical thrust | 33 kN maximum | Four symmetric virtual lift points |
| Attitude torque | 7 kN·m maximum per axis | A control abstraction with equivalent gas consumption |
| Attitude lever arm | 1.35 m | Converts requested moments to equivalent total force cost |
| Motor power / low-speed force cap | 720 kW / 18.5 kN | Power-limited propulsion at higher speed |
| Fan downforce | 12.5 kN nominal near the surface | Fades with increasing height; disabled in flight |
| Wheelbase / track / tire radius | 2.8 / 1.72 / 0.34 m | Vehicle contact geometry |
| Gravity / fixed physics step | 9.81 m/s² / 1/120 s | SI rigid-body integration |
| Training altitude target cap | 12 m | An assisted-mode lesson limit, not a real flight envelope |

Pressure is calculated as **p = p₀(m_gas/m₀)^1.4**. The residual mass at 35 bar is therefore **180 × (35/300)^(1/1.4) = 38.80 kg**. Usable gas above that cutoff is **141.20 kg**, corresponding to about **91.78 kN·s** at 650 m/s effective exhaust velocity. The simulator consumes this reserve for lift, forward thrust, and attitude correction. It does not grant a separate free attitude-control supply. Total mass decreases as gas leaves.

The assumed storage is deliberately substantial. If it represents ideal air at 293 K, the initial volume from **V = mRT/p**, using R = 287 J/(kg·K), is about **0.505 m³, or 505 liters**. That excludes vessel walls, insulation, plumbing, mounts, and unusable packing space. This is a large packaging demand for a sports car. The project does not establish that this reservoir fits a real Roadster or that the assumed dry mass accommodates validated hardware. High-pressure real-gas behavior and thermal transients are also omitted. The model is an instructional mechanism for short endurance, not a packaging feasibility study.

At full rear force, nominal flow is **22,000/650 = 33.85 kg/s**. At the maximum vertical force it is **50.77 kg/s**. Initially, merely balancing gravity requires **1,800 × 9.81 = 17.66 kN**, or **27.17 kg/s**, before attitude corrections. The reserve divided by initial hover force is about **5.2 seconds** of equivalent impulse. That quotient is an energy-budget illustration, not the actual hover duration: decreasing mass, pressure fade, takeoff and descent commands, control corrections, and regulator limits all alter the trajectory. A short, reserve-limited hover is expected; long free flight is not implied.

The motor-plus-rear-thrust caps sum to 40.5 kN. At the initial 1,800 kg mass this is a simplified initial upper estimate of 22.5 m/s², or 2.29 g, before resistance and traction effects. The selected tuning is **not calibrated to reproduce Tesla’s advertised sub-one-second launch**. A student should learn force addition and stopping judgment from it, not treat its stopwatch as a prediction of an actual car’s performance.

The assumed 12.5 kN fan adds about 71% of initial vehicle weight as downward load near the surface. The model reduces this as height increases; it does not provide unlimited adhesion in flight. Tire behavior uses raycast contacts and an engine friction approximation, rather than measured production tire data. Wet and off-runway grip changes are simulation scenarios.

Assisted flight uses a cascade: pilot directional requests create small lean targets; attitude feedback commands torque; altitude error and vertical velocity command lift. Manual mode removes that feedback but retains the chosen control abstraction. The equivalent moment budget is charged as force of approximately **|τ|/r**: a symmetric pair producing torque τ has two jets whose combined force magnitude is τ/r. That accounting teaches that stabilization is not free even when there is little visible translation.

## 12. Fidelity boundary and verification

The physics engine can integrate a rigid body, suspension contacts, gravity, collisions, propulsion forces, and rotational response. That is materially better than moving a camera along a prewritten path. It is still an approximation. A detailed visual model does not provide measured tire curves, a flexible chassis model, compressor thermodynamics, ground-seal leakage, aerodynamic coefficients across the full envelope, or a validated flight controller.

The table above publishes the main tunable assumptions. Source constants remain authoritative if a later revision changes them. The implemented rear-thrust mode has explicit arming and brake/reverse interlocks, while flight engagement requires the Rocket teaching model, a low entry speed, and a reserve margin. These are educational interface choices. They are not a recovered manufacturer operating procedure. Each lesson reset restores the reservoir to make comparisons repeatable; it is not a physical recharge process.

The proving ground is fictional. Runway, slalom, landing, and service areas exist to make experiments repeatable. Buildings and barriers need physical collision shapes where a learner can reach them; a decorative building that allows the car to pass through it undermines spatial understanding. A retry should return the student to a known state so that a different input can be compared fairly.

A strong verification pass checks more than whether a page loads: throttle changes speed in the intended direction; brake reduces it; steering sign matches the view; reserve decreases under useful thrust; no propulsion occurs while disarmed; airborne tires cease supplying ground traction; collisions alter motion; pause and focus loss release commands; lesson completion reflects the actual maneuver; and restart creates a clean state. Visual QA should inspect the driver view, external view if present, and narrow-screen controls.

## 13. Open questions to revisit when authoritative information appears

The reviewed public material does not settle the final driver interaction for flight, acceptable operational envelopes, control failure behavior, exact storage capacity, thrust-to-weight ratio through depletion, noise at the driver’s ear, compressor duty cycle, landing limits, or regional operational requirements. A future official manual, homologation record, full engineering disclosure, or independent instrumented test could change this reconstruction substantially.

The simulator should be easy to revise when such evidence arrives. Keep evidence, graphics, vehicle parameters, lesson criteria, and input mappings separated. Then an updated cockpit image or a new measured thrust curve can change the relevant system without silently rewriting every other assumption.

## Primary references and provenance

- [Tesla Roadster, live product page](https://www.tesla.com/roadster), browser-inspected 16 October 2026. The text-only web extraction returned only footnotes; the current configuration and interior descriptions were visible in the live browser. Stale indexed snippets were not used as current specifications.
- [Tesla official interior photograph](https://digitalassets.tesla.com/tesla-contents/image/upload/f_auto,q_auto/Roadster-03-Carousel-Slide-4-Mobile.jpg), viewed as a visual reference. Copyright belongs to Tesla; a link is provided for attribution and comparison, not a license for reuse.
- [NASA Glenn, Rocket Thrust Equation](https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/rocket-thrust-equation/), consulted 16 October 2026.
- [NASA Glenn, Specific Impulse](https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/specific-impulse/), consulted 16 October 2026.
- [NASA, State-of-the-Art of Small Spacecraft Technology: In-Space Propulsion](https://www.nasa.gov/smallsat-institute/sst-soa/in-space_propulsion/), Cold Gas section, consulted 16 October 2026. Spacecraft examples establish general propulsion context, not Roadster component specifications.
- [McLaughlan, Forth, and Grimes-Ledesma, Composite Overwrapped Pressure Vessels, A Primer, NASA/SP-2011-573](https://ntrs.nasa.gov/citations/20110008406), 2011, consulted 16 October 2026.

All uncredited numerical examples and proposed teaching interactions above are original analytical or simulator-design illustrations. This project is independent and is not affiliated with or endorsed by Tesla, SpaceX, or NASA.
