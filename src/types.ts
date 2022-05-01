// src/types.ts

export interface IDecoderOptions {
	useTArray?: boolean; // : true;
	colorTransform?: boolean;
	formatAsRGBA?: boolean;
	tolerantDecoding?: boolean;
	maxResolutionInMP?: number;
	maxMemoryUsageInMB?: number;
}

export interface RawImageData<T> {
	width: number;
	height: number;
	data: T;
	// comments?: string[];
	// exifBuffer?: number[];
}

export type BufferRet = RawImageData<Buffer>;
export type UintArrRet = RawImageData<Uint8Array>;

// export type ImageData = BufferRet | UintArrRet;
export type ImageData = UintArrRet;

export type BufferLike = Buffer | Uint8Array;
// | ArrayLike<number>
// | Iterable<number>
// | ArrayBuffer

// export declare function encode(imgData: RawImageData<BufferLike> & {comments?: string[]}, quality?: number): BufferRet
//
// export declare function decode(
//   jpegData: BufferLike,
//   opts: {
//     useTArray: true;
//     colorTransform?: boolean;
//     formatAsRGBA?: boolean;
//     tolerantDecoding?: boolean;
//     maxResolutionInMP?: number;
//     maxMemoryUsageInMB?: number;
//   },
// ): UintArrRet & {comments?: string[]};
// export declare function decode(
//   jpegData: BufferLike,
//   opts?: {
//     useTArray?: false;
//     colorTransform?: boolean;
//     formatAsRGBA?: boolean;
//     tolerantDecoding?: boolean;
//     maxResolutionInMP?: number;
//     maxMemoryUsageInMB?: number;
//   },
// ): BufferRet & {comments?: string[]};
