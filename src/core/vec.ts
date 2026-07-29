export interface Vec3 {
    readonly x: number;
    readonly y: number;
    readonly z: number;
}

// `|| 0` normalizes -0 (which cross products of axis vectors can produce)
// so structural equality in tests and map keys stays clean.
export const v = (x: number, y: number, z: number): Vec3 =>
    ({ x: x || 0, y: y || 0, z: z || 0 });

export const ZERO = v(0, 0, 0);
export const X = v(1, 0, 0);
export const Y = v(0, 1, 0);
export const Z = v(0, 0, 1);

export const add = (a: Vec3, b: Vec3): Vec3 => v(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub = (a: Vec3, b: Vec3): Vec3 => v(a.x - b.x, a.y - b.y, a.z - b.z);
export const neg = (a: Vec3): Vec3 => v(-a.x, -a.y, -a.z);
export const scale = (a: Vec3, s: number): Vec3 => v(a.x * s, a.y * s, a.z * s);

export const cross = (a: Vec3, b: Vec3): Vec3 =>
    v(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);

export const eq = (a: Vec3, b: Vec3): boolean => a.x === b.x && a.y === b.y && a.z === b.z;

export const key = (a: Vec3): string => `${a.x},${a.y},${a.z}`;

export const manhattan = (a: Vec3, b: Vec3): number =>
    Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z);
