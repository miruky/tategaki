// 青空文庫の配布テキストはShift_JISが主流で、近年のものはUTF-8もある。
// まず厳格なUTF-8として読み、壊れていればShift_JISとして読み直す。

export function decodeAozora(data: Uint8Array): string {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(data);
  } catch {
    text = new TextDecoder('shift_jis').decode(data);
  }
  return text.replace(/^\uFEFF/, '');
}
