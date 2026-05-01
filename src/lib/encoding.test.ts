import { describe, expect, it } from 'vitest';
import { decodeAozora } from './encoding';

describe('decodeAozora', () => {
  it('UTF-8をそのまま読む', () => {
    const data = new TextEncoder().encode('縦書きの本');
    expect(decodeAozora(data)).toBe('縦書きの本');
  });

  it('UTF-8のBOMを取り除く', () => {
    const body = new TextEncoder().encode('本文');
    const data = new Uint8Array([0xef, 0xbb, 0xbf, ...body]);
    expect(decodeAozora(data)).toBe('本文');
  });

  it('Shift_JISを判別して読む', () => {
    // 「あいう」のShift_JISバイト列
    const data = new Uint8Array([0x82, 0xa0, 0x82, 0xa2, 0x82, 0xa4]);
    expect(decodeAozora(data)).toBe('あいう');
  });

  it('Shift_JISの記号類(《》|)も読める', () => {
    // 「縦《たて》」のShift_JISバイト列
    const data = new Uint8Array([0x8f, 0x63, 0x81, 0x73, 0x82, 0xbd, 0x82, 0xc4, 0x81, 0x74]);
    expect(decodeAozora(data)).toBe('縦《たて》');
  });
});
