// The statistics Dowse's ranking uses (Python's math and statistics, and its own): the normal distribution's tail and
// its inverse, Šidák's correction, and Student's t read as z for small indexes.

/** P(Z ≥ z) for a standard normal Z: erfc(z/√2)/2, through the regularized incomplete gamma Q(1/2, z²/2). */
export function normalTail(z: number): number {
  if (z < 0) return 1 - normalTail(-z);
  return 0.5 * gammaQ(0.5, (z * z) / 2);
}

function lnGamma(x: number): number {   // Lanczos (g = 7, n = 9): ~15 digits
  const c = [0.9999999999998099, 676.5203681218851, -1259.1392167224028, 771.3234287776531, -176.6150291621406,
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
    const num = (((((((2509.0809287301227 * r + 33430.57558358813) * r + 67265.7709270087) * r +
      45921.95393154987) * r + 13731.69376550946) * r + 1971.5909503065513) * r +
      133.14166789178438) * r + 3.3871328727963665) * q;
    const den = (((((((5226.495278852854 * r + 28729.085735721943) * r + 39307.89580009271) * r +
      21213.794301586597) * r + 5394.196021424751) * r + 687.1870074920579) * r +
      42.31333070160091) * r + 1);
    return num / den;
  }
  let r = q <= 0 ? p : 1 - p;
  r = Math.sqrt(-Math.log(r));
  let x: number;
  if (r <= 5) {
    r -= 1.6;
    const num = ((((((0.0007745450142783414 * r + 0.022723844989269184) * r + 0.2417807251774506) * r +
      1.2704582524523684) * r + 3.6478483247632045) * r + 5.769497221460691) * r +
      4.630337846156546) * r + 1.4234371107496835;
    const den = ((((((1.0507500716444169e-9 * r + 0.0005475938084995345) * r + 0.015198666563616457) * r +
      0.14810397642748008) * r + 0.6897673349851) * r + 1.6763848301838038) * r +
      2.053191626637759) * r + 1;
    x = num / den;
  } else {
    r -= 5;
    const num = ((((((2.0103343992922881e-7 * r + 0.000027115555687434876) * r + 0.0012426609473880784) * r +
      0.026532189526576124) * r + 0.29656057182850487) * r + 1.7848265399172913) * r +
      5.463784911164114) * r + 6.657904643501103;
    const den = ((((((2.0442631033899397e-15 * r + 1.421511758316446e-7) * r + 0.000018463183175100548) * r +
      0.0007868691311456133) * r + 0.014875361290850615) * r + 0.1369298809227358) * r +
      0.599832206555888) * r + 1;
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
