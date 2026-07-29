import { PieceType } from './pieces';

const Y: PieceType = 'straight';
const B: PieceType = 'curveLeft';   // 青は左カーブ (blue face up = left)
const G: PieceType = 'curveRight';  // 緑は右カーブ (green face up = right)
const I: PieceType = 'inner';       // 内カーブ (orange)

/**
 * Ground-truth programs transcribed from the printed manual
 * (プログラミング練習表, Rail Cube starter set).
 */

/** Example 1: flat slotted frame; the loop runs around the inside of the slot. */
export const MANUAL_EXAMPLE_1: PieceType[] = [
    'start', Y, Y, Y, Y, I, I, Y, Y, Y, Y, Y, Y, Y, Y, I, I, Y, Y, Y,
];

/** Example 2: flat S-shaped course using all 8 left/right curves. */
export const MANUAL_EXAMPLE_2: PieceType[] = [
    'start', Y, Y, B, Y, Y, B, B, G, G, B, B, Y, Y, B, Y, Y, Y,
];
