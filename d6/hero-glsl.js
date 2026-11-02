// D6 hero: shared GLSL snippets and a seeded RNG.

export const NOISE = /* glsl */ `
float hh21(vec2 p){ p=fract(p*vec2(443.897,441.423)); p+=dot(p,p.yx+19.19); return fract((p.x+p.y)*p.x); }
float vn2(vec2 x){ vec2 i=floor(x),f=fract(x); f=f*f*(3.-2.*f);
  return mix(mix(hh21(i),hh21(i+vec2(1,0)),f.x),mix(hh21(i+vec2(0,1)),hh21(i+vec2(1,1)),f.x),f.y); }
float fbm2(vec2 p){ float v=0.,a=.5; for(int i=0;i<5;i++){ v+=a*vn2(p); p=p*2.03+vec2(1.7,9.2); a*=.5; } return v; }
`;

// screen colours are authored in sRGB; these invert the ACES fit three.js tone maps with, so a screen shows its pixels as drawn
export const INV_ACES = /* glsl */ `
uniform mat3 uInvOut; uniform mat3 uInvIn; uniform float uExp;
vec3 srgbDec(vec3 c){ return mix(c/12.92, pow((c+.055)/1.055, vec3(2.4)), step(.04045, c)); }
vec3 rrtInv(vec3 y){ vec3 a=1.-.983729*y, b=.0245786-.432951*y, c=-(.000090537+.238081*y); return (-b+sqrt(max(b*b-4.*a*c,0.)))/(2.*a); }
vec3 invACES(vec3 lin){ vec3 y=clamp(uInvOut*clamp(lin,0.,1.),0.,.985); return max(uInvIn*rrtInv(y),0.)*.6/uExp; }
`;

export function acesInverseUniforms(THREE) {
  const iIn = new THREE.Matrix3().set(0.59719, 0.35458, 0.04823, 0.07600, 0.90834, 0.01566, 0.02840, 0.13383, 0.83777).invert();
  const iOut = new THREE.Matrix3().set(1.60475, -0.53108, -0.07367, -0.10208, 1.10813, -0.00605, -0.00327, -0.07276, 1.07602).invert();
  return { uInvIn: { value: iIn }, uInvOut: { value: iOut }, uExp: { value: 1 } };
}

export function rng(seed = 7) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
