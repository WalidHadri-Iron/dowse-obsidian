// The statistics Dowse's ranking uses (Python's math and statistics, and its own): the normal distribution's tail and
// its inverse, Šidák's correction, and Student's t read as z for small indexes.

/** P(Z ≥ z) for a standard normal Z: erfc(z/√2)/2, through the regularized incomplete gamma Q(1/2, z²/2). */
export function normalTail(z: number): number {
  if (z < 0) return 1 - normalTail(-z);
  return 0.5 * gammaQ(0.5, (z * z) / 2);
}

function lnGamma(x: number): number {   // Lanczos (g = 7, n = 9): ~15 digits
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
             12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lnGamma(1 - x);
  x -= 1;
  let a = c[0];
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** The regularized upper incomplete gamma function Q(a, x): its series below a + 1, its continued fraction above. */
export function gammaQ(a: number, x: number): number {
  if (x <= 0) return 1;
  const front = Math.exp(-x + a * Math.log(x) - lnGamma(a));
  if (x < a + 1) {
    let sum = 1 / a, term = sum, n = a;
    for (let i = 0; i < 500; i++) {
      term *= x / ++n;
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * 1e-16) break;
    }
    return 1 - sum * front;
  }
  const tiny = 1e-300;
  let b = x + 1 - a, c = 1 / tiny, d = 1 / b, h = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b; if (Math.abs(d) < tiny) d = tiny;
    c = b + an / c; if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 1e-16) break;
  }
  return front * h;
}

/** The standard normal's inverse CDF: Wichura's AS241, as Python's statistics.NormalDist.inv_cdf. */
export function normalInv(p: number): number {
  if (p <= 0 || p >= 1) throw new RangeError("p must be in (0, 1)");
  const q = p - 0.5;
  if (Math.abs(q) <= 0.425) {
    const r = 0.180625 - q * q;
    const num = (((((((2.5090809287301226727e+3 * r + 3.3430575583588128105e+4) * r + 6.7265770927008700853e+4) * r +
      4.5921953931549871457e+4) * r + 1.3731693765509461125e+4) * r + 1.9715909503065514427e+3) * r +
      1.3314166789178437745e+2) * r + 3.3871328727963666080e+0) * q;
    const den = (((((((5.2264952788528545610e+3 * r + 2.8729085735721942674e+4) * r + 3.9307895800092710610e+4) * r +
      2.1213794301586595867e+4) * r + 5.3941960214247511077e+3) * r + 6.8718700749205790830e+2) * r +
      4.2313330701600911252e+1) * r + 1.0);
    return num / den;
  }
  let r = q <= 0 ? p : 1 - p;
  r = Math.sqrt(-Math.log(r));
  let x: number;
  if (r <= 5) {
    r -= 1.6;
    const num = ((((((7.74545014278341407640e-4 * r + 2.27238449892691845833e-2) * r + 2.41780725177450611770e-1) * r +
      1.27045825245236838258e+0) * r + 3.64784832476320460504e+0) * r + 5.76949722146069140550e+0) * r +
      4.63033784615654529590e+0) * r + 1.42343711074968357734e+0;
    const den = ((((((1.05075007164441684324e-9 * r + 5.47593808499534494600e-4) * r + 1.51986665636164571966e-2) * r +
      1.48103976427480074590e-1) * r + 6.89767334985100004550e-1) * r + 1.67638483018380384940e+0) * r +
      2.05319162663775882187e+0) * r + 1.0;
    x = num / den;
  } else {
    r -= 5;
    const num = ((((((2.01033439929228813265e-7 * r + 2.71155556874348757815e-5) * r + 1.24266094738807843860e-3) * r +
      2.65321895265761230930e-2) * r + 2.96560571828504891230e-1) * r + 1.78482653991729133580e+0) * r +
      5.46378491116411436990e+0) * r + 6.65790464350110377720e+0;
    const den = ((((((2.04426310338993978564e-15 * r + 1.42151175831644588870e-7) * r + 1.84631831751005468180e-5) * r +
      7.86869131145613259100e-4) * r + 1.48753612908506148525e-2) * r + 1.36929880922735805310e-1) * r +
      5.99832206555887937690e-1) * r + 1.0;
    x = num / den;
  }
  return q < 0 ? -x : x;
}

/** The best of `n` z-scores, put back on the scale of one (Šidák's correction). */
export function sidak(z: number, n: number): number {
  if (n <= 1) return z;
  const tail = normalTail(z);
  if (tail >= 1) return z;
  const tailN = -Math.expm1(n * Math.log1p(-tail));
  return -normalInv(Math.min(Math.max(tailN, 1e-300), 1 - 1e-12));
}

/** The regularized incomplete beta function I_x(a, b) (its continued fraction, by Lentz's method). */
export function betaRegularized(x: number, a: number, b: number): number {
  if (x <= 0 || x >= 1) return x <= 0 ? 0 : 1;
  if (x > (a + 1) / (a + b + 2)) return 1 - betaRegularized(1 - x, b, a);
  const front = Math.exp(lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log1p(-x));
  const tiny = 1e-300;
  let c = 1, d = 1 - (a + b) * x / (a + 1);
  d = 1 / (Math.abs(d) > tiny ? d : tiny);
  let fraction = d;
  for (let m = 1; m < 300; m++) {
    for (const step of [m * (b - m) * x / ((a + 2 * m - 1) * (a + 2 * m)),
                        -(a + m) * (a + b + m) * x / ((a + 2 * m) * (a + 2 * m + 1))]) {
      d = 1 + step * d;
      d = 1 / (Math.abs(d) > tiny ? d : tiny);
      c = 1 + step / c;
      c = Math.abs(c) > tiny ? c : tiny;
      fraction *= d * c;
    }
    if (Math.abs(d * c - 1) < 1e-14) break;
  }
  return front * fraction / a;
}

/** The z with the same one-sided chance as Student's t with `df` degrees of freedom. */
export function tAsZ(t: number, df: number): number {
  if (t === 0) return 0;
  const tail = 0.5 * betaRegularized(df / (df + t * t), df / 2, 0.5);
  const z = -normalInv(Math.min(Math.max(tail, 1e-300), 0.5));
  return t > 0 ? z : -z;
}
