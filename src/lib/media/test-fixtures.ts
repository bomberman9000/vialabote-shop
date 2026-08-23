// Генераторы минимально-валидных изображений для тестов media validator.
// Не полноценные декодируемые картинки, но валидные для sniff-mime +
// image-size (то есть ровно то, что реально проверяет наш pipeline).
export function makePngBytes(width: number, height: number): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 2; // color type: truecolor
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(13, 0);
  const typeBuf = Buffer.from("IHDR");
  const crcBuf = Buffer.alloc(4);
  return Buffer.concat([sig, lenBuf, typeBuf, ihdrData, crcBuf]);
}

export function makeJpegBytes(width: number, height: number): Buffer {
  // image-size сканирует маркеры начиная СО ВТОРОГО сегмента — нужен
  // service-маркер (APP0) перед реальным SOF0, иначе размер не находится.
  const soi = Buffer.from([0xff, 0xd8]);
  const dummyMarker = Buffer.from([0xff, 0xe0]); // APP0
  const dummyLen = Buffer.from([0x00, 0x02]); // length = только сама length-пара
  const sof0 = Buffer.from([0xff, 0xc0]);
  const sof0Len = Buffer.alloc(2);
  sof0Len.writeUInt16BE(17, 0); // length включает сами эти 2 байта
  const precision = Buffer.from([0x08]);
  const heightBuf = Buffer.alloc(2);
  heightBuf.writeUInt16BE(height, 0);
  const widthBuf = Buffer.alloc(2);
  widthBuf.writeUInt16BE(width, 0);
  const numComponents = Buffer.from([0x03]);
  const componentData = Buffer.from([1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  const eoi = Buffer.from([0xff, 0xd9]);
  return Buffer.concat([
    soi,
    dummyMarker,
    dummyLen,
    sof0,
    sof0Len,
    precision,
    heightBuf,
    widthBuf,
    numComponents,
    componentData,
    eoi,
  ]);
}

export function makeWebpBytes(width: number, height: number, animated = false): Buffer {
  // VP8X extended format chunk — несёт canvas width/height (минус 1, 24-бит LE).
  const riff = Buffer.from("RIFF");
  const webp = Buffer.from("WEBP");
  const vp8x = Buffer.from("VP8X");
  const flags = Buffer.from([animated ? 0x10 : 0x00]); // ANIM flag бит (1 байт!)
  const reserved = Buffer.alloc(3);
  const w = width - 1;
  const h = height - 1;
  const dims = Buffer.from([w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff, h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff]);
  const vp8xChunkData = Buffer.concat([flags, reserved, dims]);
  const vp8xLen = Buffer.alloc(4);
  vp8xLen.writeUInt32LE(vp8xChunkData.length, 0);
  const body = Buffer.concat([vp8x, vp8xLen, vp8xChunkData]);
  const extra = animated ? Buffer.from("ANIMANMF") : Buffer.alloc(0);
  const riffLen = Buffer.alloc(4);
  riffLen.writeUInt32LE(webp.length + body.length + extra.length, 0);
  return Buffer.concat([riff, riffLen, webp, body, extra]);
}

export function makeBrokenBytes(): Buffer {
  return Buffer.from([0xff, 0xd8, 0xff]); // валидный JPEG magic, но обрублен — decode упадёт
}

export function makeExecutableDisguisedAsImage(): Buffer {
  // MZ-заголовок Windows PE executable — не картинка вообще.
  return Buffer.concat([Buffer.from("MZ"), Buffer.alloc(100)]);
}

export function makeSvgBytes(): Buffer {
  return Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>');
}

export function makeGifBytes(): Buffer {
  return Buffer.from("GIF89a" + "\x00".repeat(20));
}
