// Vehicle dynamics: bicycle-model chassis with load transfer, slip-angle tyre
// model with a friction circle, engine + clutch + gearbox drivetrain.
// Pure JS (no three.js) so it can be tested in Node.
//
// Frame conventions: body x = forward, body y = LEFT, yaw rate r > 0 = turning
// left. World heading psi: forward = (sin psi, cos psi) in world (x, z).

const G = 9.81;
const RHO = 1.2;
const RPM = 60 / (2 * Math.PI); // rad/s -> rpm

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const smooth01 = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

// Simplified Pacejka lateral curve, normalised to peak 1 at ~7 degrees slip.
export function tyreCurve(alpha) {
  const B = 14, C = 1.9, E = 0.97;
  const x = B * alpha;
  return Math.sin(C * Math.atan(x - E * (x - Math.atan(x))));
}

export const SURFACES = {
  asphalt: { mu: 1.0, drag: 0, bump: 0 },
  kerb: { mu: 0.94, drag: 0.004, bump: 1 },
  grass: { mu: 0.58, drag: 0.09, bump: 0.6 },
};

export class CarPhysics {
  constructor(spec) {
    this.setSpec(spec);
    this.reset(0, 0, 0);
  }

  // Swap in a new spec (upgrades / mods) without resetting the car's motion.
  setSpec(spec) {
    this.spec = spec;
    this.L = spec.a + spec.b;
    this.mEffF = 1 / (1 / spec.mass + (spec.a * spec.a) / spec.inertia);
    this.mEffR = 1 / (1 / spec.mass + (spec.b * spec.b) / spec.inertia);
    this.maxTorque = Math.max(...spec.torque.map((p) => p[1]));
  }

  reset(x, z, heading) {
    this.x = x; this.z = z; this.psi = heading;
    this.u = 0; this.v = 0; this.r = 0;
    this.ax = 0; this.ay = 0; // smoothed body accelerations for load transfer & visuals
    this.omegaE = this.spec.idle / RPM;
    this.engineOn = true;
    this.stallTimer = 0;
    this.gear = 0;
    this.shiftTimer = 0;
    this.shiftCut = false;
    this.clutchRamp = 1;
    this.grinding = false;
    this.autoRevTimer = 0;
    this.tcCut = 1;
    this.limiterCut = false;
    this.clutchE = 1;
    this.delta = 0;
    // Outputs for effects/FFB/HUD.
    this.alphaF = 0; this.alphaR = 0;
    this.rearSpin = 0; // m/s of wheelspin (+) or lock (-)
    this.frontLock = false; this.rearLock = false;
    this.steerTorque = 0;
    this.slipAmount = 0;
    this.throttleEff = 0;
    this.wheelRot = 0;
    this.lastShiftDir = 0;
  }

  get rpm() { return this.omegaE * RPM; }
  get speed() { return Math.hypot(this.u, this.v); }

  gearRatio(g = this.gear) {
    if (g === 0) return 0;
    return g < 0 ? this.spec.gears[0] : this.spec.gears[g];
  }

  // Engine-side rad/s per m/s of road speed in gear g.
  totalRatio(g = this.gear) {
    return (this.gearRatio(g) * this.spec.final) / this.spec.wheelRadius;
  }

  torqueAt(rpm) {
    const t = this.spec.torque;
    if (rpm <= t[0][0]) return t[0][1];
    for (let i = 1; i < t.length; i++) {
      if (rpm <= t[i][0]) {
        const f = (rpm - t[i - 1][0]) / (t[i][0] - t[i - 1][0]);
        return t[i - 1][1] + (t[i][1] - t[i - 1][1]) * f;
      }
    }
    return t[t.length - 1][1];
  }

  // ---- Transmission (called once per frame, before stepping) ----
  // ctl: { mode: 'h'|'seq'|'auto', hGear, shiftUp, shiftDown, clutch, throttle, brake, autoClutch }
  // Returns events: 'shift', 'grind', 'stall', 'start' (array).
  updateTransmission(dt, ctl) {
    const ev = [];
    const s = this.spec;
    if (this.shiftTimer > 0) {
      this.shiftTimer -= dt;
      if (this.shiftTimer <= 0) { this.shiftTimer = 0; this.shiftCut = false; }
    }
    const top = s.gears.length - 1;
    const wheelRpmIn = (g) => Math.abs(this.totalRatio(g) * this.u) * RPM;

    if (ctl.mode === 'h') {
      const want = ctl.hGear;
      if (want !== this.gear) {
        if (want === 0) {
          this.gear = 0;
          this.grinding = false;
        } else {
          const clutchIn = ctl.clutch > 0.55;
          const wrongDir = (want < 0 && this.u > 2.5) || (want > 0 && this.u < -2.5);
          const allowed = !wrongDir && (clutchIn || ctl.autoClutch);
          if (allowed) {
            // Over-rev protection: refuse a gear that would blow the engine.
            if (ctl.autoClutch && wheelRpmIn(want) > s.limiter + 1500) {
              if (!this.grinding) ev.push('grind');
              this.grinding = true;
            } else {
              this.lastShiftDir = Math.sign(want - this.gear) || 1;
              this.gear = want;
              this.grinding = false;
              ev.push('shift');
              if (ctl.autoClutch && !clutchIn) {
                // Quick automatic clutch kick so the shift isn't a jolt.
                this.shiftTimer = 0.09;
                this.shiftCut = this.lastShiftDir > 0;
              }
            }
          } else {
            if (!this.grinding) ev.push('grind');
            this.grinding = true;
            this.gear = 0;
          }
        }
      } else {
        this.grinding = false;
      }
    } else {
      // Sequential / automatic.
      const doShift = (to) => {
        if (to === this.gear) return;
        this.lastShiftDir = Math.sign(to - this.gear);
        this.gear = to;
        this.shiftTimer = ctl.mode === 'auto' ? 0.16 : 0.1;
        this.shiftCut = this.lastShiftDir > 0;
        ev.push('shift');
      };
      if (ctl.shiftUp && this.gear < top) {
        if (this.gear === -1) doShift(0);
        else doShift(this.gear + 1);
      }
      if (ctl.shiftDown) {
        if (this.gear > 1) {
          // Don't allow a downshift that would massively over-rev.
          if (wheelRpmIn(this.gear - 1) < s.limiter + 300) doShift(this.gear - 1);
          else ev.push('denied');
        } else if (this.gear === 1) doShift(0);
        else if (this.gear === 0 && this.u < 2) doShift(-1);
      }
      if (ctl.mode === 'auto' && this.shiftTimer === 0) {
        if (this.gear === 0) doShift(1);
        else if (this.gear > 0) {
          const rpm = this.rpm;
          // Shift on road speed (not engine rpm) so wheelspin or a slipping clutch
          // can't trigger an upshift.
          if (rpm > s.redline - 150 && wheelRpmIn(this.gear) > s.redline - 450 && this.gear < top && this.clutchE > 0.9) doShift(this.gear + 1);
          else if (this.gear > 1) {
            const lower = wheelRpmIn(this.gear - 1);
            const downAt = ctl.brake > 0.2 ? s.redline * 0.72 : s.redline * 0.55;
            if (lower < downAt) doShift(this.gear - 1);
          }
          // Hold brake at a standstill to engage reverse.
          if (this.gear === 1 && this.u < 0.5 && ctl.brake > 0.3 && ctl.throttle < 0.05) {
            this.autoRevTimer += dt;
            if (this.autoRevTimer > 0.45) { doShift(-1); this.autoRevTimer = 0; }
          } else this.autoRevTimer = 0;
        } else if (this.gear === -1) {
          // In reverse the pedals are swapped by the caller; brake (= real throttle) to go forward again.
          if (this.u > -0.5 && ctl.brake > 0.3 && ctl.throttle < 0.05) {
            this.autoRevTimer += dt;
            if (this.autoRevTimer > 0.3) { doShift(1); this.autoRevTimer = 0; }
          } else this.autoRevTimer = 0;
        }
      }
    }

    // Stall handling (only possible without auto clutch).
    if (!this.engineOn) {
      this.stallTimer += dt;
      if ((ctl.clutch > 0.7 || this.gear === 0) && this.stallTimer > 0.8) {
        this.engineOn = true;
        this.omegaE = s.idle / RPM;
        this.stallTimer = 0;
        ev.push('start');
      }
    }
    return ev;
  }

  // ---- One physics sub-step ----
  // inp: { throttle, brake, clutch, steer (-1..1, + = right), handbrake, nitro, autoClutch, abs, tc, stability }
  // env: { mu, drag, slope (dh per metre forward) }
  step(h, inp, env) {
    const s = this.spec;
    const m = s.mass;
    const u = this.u, v = this.v, r = this.r;
    const absU = Math.abs(u);

    // --- Steering ---
    this.delta = -clamp(inp.steer, -1, 1) * s.maxSteer;
    const delta = this.delta;

    // --- Loads ---
    const down = 0.5 * RHO * s.clA * u * u;
    const transfer = (m * this.ax * s.cgHeight) / this.L;
    let Nf = (m * G * s.b) / this.L - transfer + down * s.aeroFront;
    let Nr = (m * G * s.a) / this.L + transfer + down * (1 - s.aeroFront);
    Nf = Math.max(Nf, m * G * 0.12);
    Nr = Math.max(Nr, m * G * 0.12);
    const muF = s.mu * s.frontGrip * env.mu;
    const muR = s.mu * s.rearGrip * env.mu;

    // --- Engine ---
    let throttle = clamp(inp.throttle, 0, 1);
    const rpm = this.omegaE * RPM;
    if (rpm > s.limiter) this.limiterCut = true;
    else if (rpm < s.limiter - 250) this.limiterCut = false;
    if (this.limiterCut || this.shiftCut || !this.engineOn) throttle = 0;
    if (inp.tc) throttle *= this.tcCut;
    if (inp.stability && this.stabilityCut !== undefined) throttle *= this.stabilityCut;
    // Idle controller keeps the engine alive.
    if (this.engineOn && rpm < s.idle + 150) throttle = Math.max(throttle, clamp((s.idle + 150 - rpm) / 400, 0, 1) * 0.45);
    this.throttleEff = throttle;
    let Te = 0;
    if (this.engineOn) {
      // Nitrous adds torque on top of whatever the throttle asks for.
      const boost = inp.nitro ? 1 + (s.nitroBoost || 0.6) : 1;
      const drive = this.torqueAt(rpm) * throttle * boost;
      const braking = (1 - throttle) * (25 + rpm * 0.011);
      Te = drive - braking;
    } else {
      Te = -(40 + rpm * 0.02);
    }
    this.omegaE += (Te / s.engineInertia) * h;
    if (this.omegaE < 0) this.omegaE = 0;

    // --- Clutch engagement ---
    const Gr = this.totalRatio();
    let e = 1 - smooth01(0.18, 0.8, clamp(inp.clutch, 0, 1));
    if (this.shiftTimer > 0) {
      // Automated shift: clutch open while the engine is rev-matched to the new gear.
      e = 0;
      this.clutchRamp = 0;
      if (Gr !== 0) {
        const sync = Math.max(s.idle / RPM, Math.abs(Gr * u));
        this.omegaE += (sync - this.omegaE) * Math.min(1, h * 30);
      }
    } else if (this.clutchRamp < 1) {
      this.clutchRamp = Math.min(1, this.clutchRamp + h / 0.09);
      e = Math.min(e, this.clutchRamp);
    }
    if (inp.handbrake) e = 0;
    if (this.gear !== 0 && inp.autoClutch) {
      // Launch: the auto clutch slips until the engine is near its torque band.
      const wheelRpm = Math.abs(Gr * u) * RPM;
      const bite = s.idle + 400 + 1800 * clamp(inp.throttle, 0, 1);
      if (wheelRpm < bite) {
        const launch = clamp((this.omegaE * RPM - s.idle - 120) / (bite - s.idle), 0, 1);
        e = Math.min(e, launch * launch * (3 - 2 * launch));
      }
    }
    this.clutchE = e;

    // --- Drivetrain joint (engine <-> road through clutch and rear tyres) ---
    let Fdrive = 0;
    this.rearSpin = 0;
    if (Gr !== 0 && e > 0.001) {
      const mv = m * 1.06; // + rotating inertia
      const Ie = s.engineInertia;
      const dOmega = this.omegaE - Gr * u;
      let J = dOmega / (1 / Ie + (Gr * Gr) / mv);
      const Fclutch = s.clutchTorque * e * Math.abs(Gr);
      const Ftyre = muR * Nr * 1.12;
      const Fcap = Math.min(Fclutch, Ftyre);
      const Jmax = (Fcap * h) / Math.abs(Gr);
      let limited = false;
      if (J > Jmax) { J = Jmax; limited = true; }
      else if (J < -Jmax) { J = -Jmax; limited = true; }
      // Never let the road spin the engine past its limit (clutch slips instead).
      const maxOmega = (s.limiter + 600) / RPM;
      if (this.omegaE - J / Ie > maxOmega) J = (this.omegaE - maxOmega) * Ie;
      this.omegaE -= J / Ie;
      Fdrive = (J * Gr) / h;
      if (limited && Ftyre < Fclutch) {
        this.rearSpin = this.omegaE / Gr - u;
      }
    }
    // Traction control: back off throttle while the rears spin, or when drive
    // force plus cornering would overload the rear tyres (power oversteer).
    const spinning = Math.abs(this.rearSpin) > 1.2 && this.rearSpin * u >= 0;
    const longUse = (Fdrive * Math.sign(u || 1)) / (muR * Nr * 1.12);
    const latUse = Math.abs(tyreCurve(this.alphaR));
    const combined = longUse > 0.1 && absU > 4 ? Math.sqrt(longUse * longUse + latUse * latUse) : 0;
    // Smoothly trim torque instead of cutting it (a hard cut = lift-off oversteer).
    let tcTarget = clamp(1 - (combined - 0.88) * 5, 0.3, 1);
    if (spinning) tcTarget = Math.min(tcTarget, 0.25);
    this.tcCut += (tcTarget - this.tcCut) * Math.min(1, h * (tcTarget < this.tcCut ? 14 : 3));

    // Stall.
    if (this.engineOn && !inp.autoClutch && this.gear !== 0 && e > 0.6 && this.omegaE * RPM < 420) {
      this.engineOn = false;
      this.stallTimer = 0;
      this.stalledEvent = true;
    }

    // --- Brakes ---
    const brake = clamp(inp.brake, 0, 1);
    const Fb = brake * s.brakeForce;
    let FbF = Fb * s.brakeBias, FbR = Fb * (1 - s.brakeBias);
    this.frontLock = false; this.rearLock = false;
    if (inp.abs) {
      FbF = Math.min(FbF, muF * Nf * 0.97);
      FbR = Math.min(FbR, muR * Nr * 0.97);
    } else {
      if (FbF > muF * Nf && absU > 1) { FbF = muF * Nf * 0.88; this.frontLock = true; }
      if (FbR > muR * Nr && absU > 1) { FbR = muR * Nr * 0.88; this.rearLock = true; }
    }
    if (inp.handbrake && absU > 0.5) { FbR = Math.max(FbR, muR * Nr * 0.85); this.rearLock = true; }

    // --- Front tyre ---
    const cd = Math.cos(delta), sd = Math.sin(delta);
    const vyF = v + s.a * r;
    const vxW = u * cd + vyF * sd;
    const vyW = -u * sd + vyF * cd;
    const alphaF = Math.atan2(vyW, Math.abs(vxW));
    let FxWf = -Math.sign(vxW) * Math.min(FbF, (this.mEffF * Math.abs(vxW)) / h);
    const capF = muF * Nf;
    FxWf = clamp(FxWf, -capF, capF);
    let FyWf = -capF * tyreCurve(alphaF) * Math.sqrt(Math.max(0.04, 1 - (FxWf / capF) ** 2));
    if (this.frontLock) FyWf *= 0.35;
    const cancelF = (this.mEffF * Math.abs(vyW)) / h;
    FyWf = clamp(FyWf, -cancelF, cancelF);
    const FxF = FxWf * cd - FyWf * sd;
    const FyF = FxWf * sd + FyWf * cd;

    // --- Rear tyre ---
    const vyR = v - s.b * r;
    const alphaR = Math.atan2(vyR, Math.abs(u));
    const capR = muR * Nr;
    const capRx = capR * 1.12; // tyres grip a little better longitudinally
    let FxR = Fdrive - Math.sign(u) * Math.min(FbR, (this.mEffR * absU) / h);
    FxR = clamp(FxR, -capRx, capRx);
    let latScale = Math.sqrt(Math.max(0.06, 1 - (FxR / capRx) ** 2));
    if (Math.abs(this.rearSpin) > 0.5) latScale = Math.min(latScale, clamp(1 - Math.abs(this.rearSpin) / 8, 0.3, 1));
    let FyR = -capR * tyreCurve(alphaR) * latScale;
    if (this.rearLock) FyR *= 0.35;
    const cancelR = (this.mEffR * Math.abs(vyR)) / h;
    FyR = clamp(FyR, -cancelR, cancelR);

    // --- Resistances ---
    const drag = 0.5 * RHO * s.cdA * u * Math.abs(u);
    const rollC = 0.014 + env.drag * clamp(absU / 4, 0, 1);
    const roll = Math.sign(u) * Math.min(rollC * m * G, (m * absU) / h);
    const gradeF = -m * G * env.slope;

    // --- Stability assist (keyboard friendly) ---
    let Mz = s.a * FyF - s.b * FyR;
    this.stabilityCut = 1;
    if (inp.stability && absU > 3) {
      const rDes = (u * delta) / (this.L * (1 + (u * u) / 900));
      const rMax = (s.mu * G * 1.05) / absU;
      const target = clamp(rDes, -rMax, rMax);
      const err = r - target;
      if (Math.abs(err) > 0.05) {
        Mz -= err * s.inertia * 3.0;
        this.stabilityCut = clamp(1 - Math.abs(err) * 1.5, 0.35, 1);
      }
    }

    const Fx = FxF + FxR - drag - roll + gradeF;
    const Fy = FyF + FyR;

    let du = (Fx / m + v * r) * h;
    let dv = (Fy / m - u * r) * h;
    let dr = (Mz / s.inertia) * h;
    this.u += du;
    this.v += dv;
    this.r += dr;

    // Low-speed kinematic blend so parking speeds are stable.
    if (absU < 2.5) {
      const k = (1 - absU / 2.5) * Math.min(1, h * 25);
      const rKin = (this.u * Math.tan(delta)) / this.L;
      this.r += (rKin - this.r) * k;
      this.v += (0 - this.v) * k;
    }
    if (Math.abs(this.u) < 0.02 && throttle < 0.05 && Fdrive === 0) this.u *= 0.5;

    this.psi += this.r * h;
    const sp = Math.sin(this.psi), cp = Math.cos(this.psi);
    this.x += (this.u * sp + this.v * cp) * h;
    this.z += (this.u * cp - this.v * sp) * h;

    // Smoothed accelerations (body frame) for load transfer and visuals.
    const axInst = du / h - v * r;
    const ayInst = dv / h + u * r;
    this.ax += (axInst - this.ax) * Math.min(1, h * 12);
    this.ay += (ayInst - this.ay) * Math.min(1, h * 12);

    // Outputs.
    this.alphaF = alphaF; this.alphaR = alphaR;
    this.Nf = Nf; this.Nr = Nr;
    const trail = 0.03 * Math.max(0, 1 - Math.abs(alphaF) / 0.22) + 0.012;
    this.steerTorque = FyWf * trail; // N·m, + pushes the wheel to the right
    this.steerTorqueRef = muF * Nf * 0.03;
    const latSlide = Math.max(0, Math.abs(alphaR) - 0.12) * absU + Math.max(0, Math.abs(alphaF) - 0.14) * absU * 0.6;
    this.slipAmount = latSlide + Math.abs(this.rearSpin) * 0.8 + ((this.frontLock || this.rearLock) ? absU * 0.5 : 0);
    this.wheelRot += (this.rearSpin + this.u) / s.wheelRadius * h;
  }

  // Apply a world-space impulse (N·s) at world point (px, pz).
  applyImpulse(jx, jz, px, pz) {
    const s = this.spec;
    const sp = Math.sin(this.psi), cp = Math.cos(this.psi);
    // World -> body: forward = (sp, cp), left = (cp, -sp)
    const jf = jx * sp + jz * cp;
    const jl = jx * cp - jz * sp;
    const rx = px - this.x, rz = pz - this.z;
    const rf = rx * sp + rz * cp;
    const rl = rx * cp - rz * sp;
    this.u += jf / s.mass;
    this.v += jl / s.mass;
    // Torque about the vertical axis (body frame f x l, left-positive yaw).
    this.r += (rf * jl - rl * jf) / s.inertia;
  }

  // World velocity at a world point.
  velocityAt(px, pz) {
    const sp = Math.sin(this.psi), cp = Math.cos(this.psi);
    const rx = px - this.x, rz = pz - this.z;
    const rf = rx * sp + rz * cp;
    const rl = rx * cp - rz * sp;
    const vf = this.u - this.r * rl;
    const vl = this.v + this.r * rf;
    return { x: vf * sp + vl * cp, z: vf * cp - vl * sp };
  }
}

export { RPM };
