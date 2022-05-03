/* -*- tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- /
/* vim: set shiftwidth=2 tabstop=2 autoindent cindent expandtab: */
/*
   Copyright 2011 notmasteryet

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
*/

// - The JPEG specification can be found in the ITU CCITT Recommendation T.81
//   (www.w3.org/Graphics/JPEG/itu-t81.pdf)
// - The JFIF specification can be found in the JPEG File Interchange Format
//   (www.w3.org/Graphics/JPEG/jfif3.pdf)
// - The Adobe Application-Specific JPEG markers in the Supporting the DCT Filters
//   in PostScript Level 2, Technical Note #5116
//   (partners.adobe.com/public/developer/en/ps/sdk/5116.DCT_Filter.pdf)

import { BufferLike, IDecoderOptions, RawImageData, UintArrRet } from './types';

// type DataArray = number[];
type DataArray = Uint8Array;
// type DataArray = Buffer;

// type HuffmanTree = any;
// type HuffmanTreeA = number | HuffmanTreeA[];
interface IHuffmanTree {
	index: number;
	// children: IHuffmanTree[];
	// children: Array<number | IHuffmanTree>;
	children: HuffmanTable;
}
type HuffmanTree = IHuffmanTree;
type HuffmanTable = HuffmanTree[];

// type Component = any;
interface IComponent {
	h: number;
	v: number;
	pred: number;
	quantizationTable: Int32Array;
	quantizationIdx?: number;
	blocks: Int32Array[][];
	blocksPerLine: number;
	blocksPerColumn: number;
	huffmanTableAC: HuffmanTable;
	huffmanTableDC: HuffmanTable;
	lines: Uint8Array[];
	scaleX: number;
	scaleY: number;
}
type Component = IComponent;

interface IFrame {
	precision: number;
	samplesPerLine: number;
	scanLines: number;
	mcusPerLine: number;
	mcusPerColumn: number;
	extended: boolean;
	progressive: boolean;
	maxH: number;
	maxV: number;

	// components: any;
	components: Component[];
	// componentsOrder = [];
	componentsOrder: number[];
}

const defaultIFrame: IFrame = {
	precision: 0,
	samplesPerLine: 0,
	scanLines: 0,
	mcusPerLine: 0,
	mcusPerColumn: 0,
	extended: false,
	progressive: false,
	maxH: 0,
	maxV: 0,

	// components: {},
	components: [],
	componentsOrder: []
};

interface IJFIF {
	version: { major: number; minor: number };
	densityUnits: number;
	xDensity: number;
	yDensity: number;
	thumbWidth: number;
	thumbHeight: number; // appData[13], appData is a Uint8Array
	thumbData: Uint8Array;
}

const defaultJFIFValue: IJFIF = {
	version: { major: 0, minor: 0 },
	densityUnits: 0,
	xDensity: 0,
	yDensity: 0,
	thumbWidth: 0,
	thumbHeight: 0, // appData[13], appData is a Uint8Array
	thumbData: new Uint8Array()
};

interface IAdobe {
	version: number;
	flags0: number;
	flags1: number;
	transformCode: number;
}

const defaultAdobeValue: IAdobe = {
	version: 0,
	flags0: 0,
	flags1: 0,
	transformCode: 0
};

const dctZigZag = new Int32Array([
	0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27,
	20, 13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51,
	58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63
]);

const dctCos1 = 4017; // cos(pi/16)
const dctSin1 = 799; // sin(pi/16)
const dctCos3 = 3406; // cos(3*pi/16)
const dctSin3 = 2276; // sin(3*pi/16)
const dctCos6 = 1567; // cos(6*pi/16)
const dctSin6 = 3784; // sin(6*pi/16)
const dctSqrt2 = 5793; // sqrt(2)
const dctSqrt1d2 = 2896; // sqrt(2) / 2

const defaultOpts: IDecoderOptions = {
	// "undefined" means "Choose whether to transform colors based on the image’s color model."
	colorTransform: undefined,
	useTArray: false,
	formatAsRGBA: true,
	tolerantDecoding: true,
	maxResolutionInMP: 100, // Don't decode more than 100 megapixels
	maxMemoryUsageInMB: 512 // Don't decode if memory footprint is more than 512MB
};

// let JpegImage = (function jpegImage() {
// 	'use strict';
class JpegImage {
	public width = 0;
	public height = 0;
	public comments: string[] = [];
	public exifBuffer: Uint8Array | undefined;
	// public exifBuffer: number[] | undefined;
	public opts = defaultOpts;
	public jfif = defaultJFIFValue;
	public adobe = defaultAdobeValue;
	public components: Component[] = [];

	// constructor() {}

	// public buildHuffmanTable(codeLengths: Uint8Array, values: Uint8Array): any[] {
	public buildHuffmanTable(codeLengths: Uint8Array, values: Uint8Array): HuffmanTable {
		let k = 0,
			length = 16;
		// const code: Array<number | IHuffmanTree> = [];
		// const code: IHuffmanTree[] = [];
		const code: any[] = [];

		while (length > 0 && !codeLengths[length - 1]) {
			length--;
		}

		code.push({ children: [], index: 0 });

		let p = code[0];

		for (let i = 0; i < length; i++) {
			for (let j = 0; j < codeLengths[i]; j++) {
				const pp = code.pop();

				if (typeof pp === 'undefined') {
					throw new Error('buildHuffmanTable() : code stack underflow (1)');
				}

				p = pp;
				p.children[p.index] = values[k];

				while (p.index > 0) {
					if (code.length === 0) {
						throw new Error('Could not recreate Huffman Table');
					}

					const ppp = code.pop();

					if (typeof ppp === 'undefined') {
						throw new Error('buildHuffmanTable() : code stack underflow (2)');
					}

					p = ppp;
				}

				p.index++;
				code.push(p);

				while (code.length <= i) {
					const q = { children: [], index: 0 };

					code.push(q);
					p.children[p.index] = q.children;
					p = q;
				}

				k++;
			}

			if (i + 1 < length) {
				// p here points to the last code
				const q = { children: [], index: 0 };

				code.push(q);
				p.children[p.index] = q.children;
				p = q;
			}
		}

		return code[0].children;
	}

	public decodeScan(
		data: DataArray,
		offset: number,
		frame: IFrame,
		components: Component[],
		resetInterval: number,
		spectralStart: number,
		spectralEnd: number,
		successivePrev: number,
		successive: number,
		opts: IDecoderOptions
	) {
		// let precision = frame.precision;
		// let samplesPerLine = frame.samplesPerLine;
		// let scanLines = frame.scanLines;
		const mcusPerLine = frame.mcusPerLine;
		const progressive = frame.progressive;
		// let maxH = frame.maxH,
		// 	maxV = frame.maxV;

		const startOffset = offset;
		let bitsData = 0,
			bitsCount = 0;

		function readBit(): number /* | undefined */ {
			// ThAW: Can this return null?
			// Should we return undefined if the EOF is reached?
			if (bitsCount > 0) {
				bitsCount--;
				return (bitsData >> bitsCount) & 1;
			}
			bitsData = data[offset++];
			if (bitsData == 0xff) {
				const nextByte = data[offset++];
				if (nextByte) {
					throw new Error(
						'readBit() : unexpected marker: ' +
							((bitsData << 8) | nextByte).toString(16)
					);
				}
				// unstuff 0
			}

			bitsCount = 7;

			return bitsData >>> 7;
		}

		function decodeHuffman(tree: HuffmanTable): number /* | undefined */ {
			let node: any = tree,
				bit: number | undefined;

			while (typeof (bit = readBit()) !== 'undefined') {
				node = node[bit];
				// type HuffmanTree = number | HuffmanTree[];

				if (typeof node === 'number') {
					return node;
				} else if (typeof node !== 'object') {
					throw new Error('invalid huffman sequence');
				}
			}

			// return undefined;
			throw new Error('decodeHuffman() : End of bits');
		}

		function receive(length: number): number /* | undefined */ {
			let n = 0;

			while (length > 0) {
				const bit = readBit();

				if (typeof bit === 'undefined') {
					// return undefined;
					throw new Error('receive() : bitt is undefined');
				}

				n = (n << 1) | bit;
				length--;
			}

			return n;
		}

		function receiveAndExtend(length: number): number {
			const n = receive(length);

			if (typeof n === 'undefined') {
				throw new Error('receiveAndExtend() : received undefined');
			}

			if (n >= 1 << (length - 1)) {
				return n;
			}

			return n + (-1 << length) + 1;
		}

		function decodeBaseline(component: Component, zz: Int32Array): void {
			const t = decodeHuffman(component.huffmanTableDC);
			const diff = t === 0 ? 0 : receiveAndExtend(t);
			zz[0] = component.pred += diff;
			let k = 1;
			while (k < 64) {
				const rs = decodeHuffman(component.huffmanTableAC);
				const s = rs & 15,
					r = rs >> 4;
				if (s === 0) {
					if (r < 15) break;
					k += 16;
					continue;
				}
				k += r;
				const z = dctZigZag[k];
				zz[z] = receiveAndExtend(s);
				k++;
			}
		}

		function decodeDCFirst(component: Component, zz: Int32Array): void {
			const t = decodeHuffman(component.huffmanTableDC);
			const diff = t === 0 ? 0 : receiveAndExtend(t) << successive;
			zz[0] = component.pred += diff;
		}

		function decodeDCSuccessive(component: Component, zz: Int32Array): void {
			zz[0] |= readBit() << successive;
		}

		let eobrun = 0;

		function decodeACFirst(component: Component, zz: Int32Array): void {
			if (eobrun > 0) {
				eobrun--;
				return;
			}
			let k = spectralStart;
			const e = spectralEnd;
			while (k <= e) {
				const rs = decodeHuffman(component.huffmanTableAC);
				const s = rs & 15,
					r = rs >> 4;
				if (s === 0) {
					if (r < 15) {
						eobrun = receive(r) + (1 << r) - 1;
						break;
					}
					k += 16;
					continue;
				}
				k += r;
				const z = dctZigZag[k];
				zz[z] = receiveAndExtend(s) * (1 << successive);
				k++;
			}
		}

		let successiveACState = 0,
			successiveACNextValue = 0;

		function decodeACSuccessive(component: Component, zz: Int32Array): void {
			let k = spectralStart;
			let r = 0;
			const e = spectralEnd;

			while (k <= e) {
				const z = dctZigZag[k];
				const direction = zz[z] < 0 ? -1 : 1;
				let rs = 0,
					s = 0;

				switch (successiveACState) {
					case 0: // initial state
						rs = decodeHuffman(component.huffmanTableAC);
						s = rs & 15;

						/* let */ r = rs >> 4;

						if (s === 0) {
							if (r < 15) {
								eobrun = receive(r) + (1 << r);
								successiveACState = 4;
							} else {
								r = 16;
								successiveACState = 1;
							}
						} else {
							if (s !== 1) {
								throw new Error('invalid ACn encoding');
							}

							successiveACNextValue = receiveAndExtend(s);
							successiveACState = r ? 2 : 3;
						}

						continue;

					case 1: // skipping r zero items
					case 2:
						if (zz[z]) {
							zz[z] += (readBit() << successive) * direction;
						} else {
							r--;

							if (r === 0) {
								successiveACState = successiveACState == 2 ? 3 : 0;
							}
						}
						break;

					case 3: // set value for a zero item
						if (zz[z]) {
							zz[z] += (readBit() << successive) * direction;
						} else {
							zz[z] = successiveACNextValue << successive;
							successiveACState = 0;
						}

						break;

					case 4: // eob
						if (zz[z]) {
							zz[z] += (readBit() << successive) * direction;
						}

						break;
				}

				k++;
			}

			if (successiveACState === 4) {
				eobrun--;

				if (eobrun === 0) {
					successiveACState = 0;
				}
			}
		}

		function decodeMcu(
			component: Component,
			decode: (component: Component, zz: Int32Array) => void,
			mcu: number,
			row: number,
			col: number
		): void {
			const mcuRow = (mcu / mcusPerLine) | 0;
			const mcuCol = mcu % mcusPerLine;
			const blockRow = mcuRow * component.v + row;
			const blockCol = mcuCol * component.h + col;

			// If the block is missing and we're in tolerant mode, just skip it.

			if (typeof component.blocks[blockRow] === 'undefined' && opts.tolerantDecoding) {
				return;
			}

			decode(component, component.blocks[blockRow][blockCol]);
		}

		function decodeBlock(
			component: Component,
			decode: (component: Component, zz: Int32Array) => void,
			mcu: number
		): void {
			const blockRow = (mcu / component.blocksPerLine) | 0;
			const blockCol = mcu % component.blocksPerLine;
			// If the block is missing and we're in tolerant mode, just skip it.
			if (component.blocks[blockRow] === undefined && opts.tolerantDecoding) return;
			decode(component, component.blocks[blockRow][blockCol]);
		}

		const componentsLength = components.length;
		let component, i, j, k, n;
		let decodeFn: (component: Component, zz: Int32Array) => void;

		if (progressive) {
			if (spectralStart === 0) {
				decodeFn = successivePrev === 0 ? decodeDCFirst : decodeDCSuccessive;
			} else {
				decodeFn = successivePrev === 0 ? decodeACFirst : decodeACSuccessive;
			}
		} else {
			decodeFn = decodeBaseline;
		}

		let mcu = 0,
			marker,
			mcuExpected = 0;

		if (componentsLength === 1) {
			mcuExpected = components[0].blocksPerLine * components[0].blocksPerColumn;
		} else {
			mcuExpected = mcusPerLine * frame.mcusPerColumn;
		}

		if (!resetInterval) {
			resetInterval = mcuExpected;
		}

		let h, v;
		while (mcu < mcuExpected) {
			// reset interval stuff
			for (i = 0; i < componentsLength; i++) {
				components[i].pred = 0;
			}

			eobrun = 0;

			if (componentsLength == 1) {
				component = components[0];
				for (n = 0; n < resetInterval; n++) {
					decodeBlock(component, decodeFn, mcu);
					mcu++;
				}
			} else {
				for (n = 0; n < resetInterval; n++) {
					for (i = 0; i < componentsLength; i++) {
						component = components[i];
						h = component.h;
						v = component.v;
						for (j = 0; j < v; j++) {
							for (k = 0; k < h; k++) {
								decodeMcu(component, decodeFn, mcu, j, k);
							}
						}
					}
					mcu++;

					// If we've reached our expected MCU's, stop decoding
					if (mcu === mcuExpected) break;
				}
			}

			if (mcu === mcuExpected) {
				// Skip trailing bytes at the end of the scan - until we reach the next marker
				do {
					if (data[offset] === 0xff) {
						if (data[offset + 1] !== 0x00) {
							break;
						}
					}
					offset += 1;
				} while (offset < data.length - 2);
			}

			// find marker
			bitsCount = 0;
			marker = (data[offset] << 8) | data[offset + 1];
			if (marker < 0xff00) {
				throw new Error('marker was not found');
			}

			if (marker >= 0xffd0 && marker <= 0xffd7) {
				// RSTx
				offset += 2;
			} else break;
		}

		return offset - startOffset;
	}

	public buildComponentData(frame: IFrame, component: Component): Uint8Array[] {
		const lines: Uint8Array[] = [];
		const blocksPerLine = component.blocksPerLine;
		const blocksPerColumn = component.blocksPerColumn;
		const samplesPerLine = blocksPerLine << 3;
		// Only 1 used per invocation of this function and garbage collected after invocation, so no need to account for its memory footprint.
		const R = new Int32Array(64),
			r = new Uint8Array(64);

		// A port of poppler's IDCT method which in turn is taken from:
		//   Christoph Loeffler, Adriaan Ligtenberg, George S. Moschytz,
		//   "Practical Fast 1-D DCT Algorithms with 11 Multiplications",
		//   IEEE Intl. Conf. on Acoustics, Speech & Signal Processing, 1989,
		//   988-991.
		function quantizeAndInverse(
			zz: Int32Array,
			dataOut: Uint8Array,
			dataIn: Int32Array
		): void {
			const qt = component.quantizationTable;
			let v0, v1, v2, v3, v4, v5, v6, v7, t;
			const p = dataIn;
			let i;

			// dequant
			for (i = 0; i < 64; i++) {
				p[i] = zz[i] * qt[i];
			}

			// inverse DCT on rows
			for (i = 0; i < 8; ++i) {
				const row = 8 * i;

				// check for all-zero AC coefficients
				if (
					p[1 + row] == 0 &&
					p[2 + row] == 0 &&
					p[3 + row] == 0 &&
					p[4 + row] == 0 &&
					p[5 + row] == 0 &&
					p[6 + row] == 0 &&
					p[7 + row] == 0
				) {
					t = (dctSqrt2 * p[0 + row] + 512) >> 10;
					p[0 + row] = t;
					p[1 + row] = t;
					p[2 + row] = t;
					p[3 + row] = t;
					p[4 + row] = t;
					p[5 + row] = t;
					p[6 + row] = t;
					p[7 + row] = t;
					continue;
				}

				// stage 4
				v0 = (dctSqrt2 * p[0 + row] + 128) >> 8;
				v1 = (dctSqrt2 * p[4 + row] + 128) >> 8;
				v2 = p[2 + row];
				v3 = p[6 + row];
				v4 = (dctSqrt1d2 * (p[1 + row] - p[7 + row]) + 128) >> 8;
				v7 = (dctSqrt1d2 * (p[1 + row] + p[7 + row]) + 128) >> 8;
				v5 = p[3 + row] << 4;
				v6 = p[5 + row] << 4;

				// stage 3
				t = (v0 - v1 + 1) >> 1;
				v0 = (v0 + v1 + 1) >> 1;
				v1 = t;
				t = (v2 * dctSin6 + v3 * dctCos6 + 128) >> 8;
				v2 = (v2 * dctCos6 - v3 * dctSin6 + 128) >> 8;
				v3 = t;
				t = (v4 - v6 + 1) >> 1;
				v4 = (v4 + v6 + 1) >> 1;
				v6 = t;
				t = (v7 + v5 + 1) >> 1;
				v5 = (v7 - v5 + 1) >> 1;
				v7 = t;

				// stage 2
				t = (v0 - v3 + 1) >> 1;
				v0 = (v0 + v3 + 1) >> 1;
				v3 = t;
				t = (v1 - v2 + 1) >> 1;
				v1 = (v1 + v2 + 1) >> 1;
				v2 = t;
				t = (v4 * dctSin3 + v7 * dctCos3 + 2048) >> 12;
				v4 = (v4 * dctCos3 - v7 * dctSin3 + 2048) >> 12;
				v7 = t;
				t = (v5 * dctSin1 + v6 * dctCos1 + 2048) >> 12;
				v5 = (v5 * dctCos1 - v6 * dctSin1 + 2048) >> 12;
				v6 = t;

				// stage 1
				p[0 + row] = v0 + v7;
				p[7 + row] = v0 - v7;
				p[1 + row] = v1 + v6;
				p[6 + row] = v1 - v6;
				p[2 + row] = v2 + v5;
				p[5 + row] = v2 - v5;
				p[3 + row] = v3 + v4;
				p[4 + row] = v3 - v4;
			}

			// inverse DCT on columns
			for (i = 0; i < 8; ++i) {
				const col = i;

				// check for all-zero AC coefficients
				if (
					p[1 * 8 + col] == 0 &&
					p[2 * 8 + col] == 0 &&
					p[3 * 8 + col] == 0 &&
					p[4 * 8 + col] == 0 &&
					p[5 * 8 + col] == 0 &&
					p[6 * 8 + col] == 0 &&
					p[7 * 8 + col] == 0
				) {
					t = (dctSqrt2 * dataIn[i + 0] + 8192) >> 14;
					p[0 * 8 + col] = t;
					p[1 * 8 + col] = t;
					p[2 * 8 + col] = t;
					p[3 * 8 + col] = t;
					p[4 * 8 + col] = t;
					p[5 * 8 + col] = t;
					p[6 * 8 + col] = t;
					p[7 * 8 + col] = t;
					continue;
				}

				// stage 4
				v0 = (dctSqrt2 * p[0 * 8 + col] + 2048) >> 12;
				v1 = (dctSqrt2 * p[4 * 8 + col] + 2048) >> 12;
				v2 = p[2 * 8 + col];
				v3 = p[6 * 8 + col];
				v4 = (dctSqrt1d2 * (p[1 * 8 + col] - p[7 * 8 + col]) + 2048) >> 12;
				v7 = (dctSqrt1d2 * (p[1 * 8 + col] + p[7 * 8 + col]) + 2048) >> 12;
				v5 = p[3 * 8 + col];
				v6 = p[5 * 8 + col];

				// stage 3
				t = (v0 - v1 + 1) >> 1;
				v0 = (v0 + v1 + 1) >> 1;
				v1 = t;
				t = (v2 * dctSin6 + v3 * dctCos6 + 2048) >> 12;
				v2 = (v2 * dctCos6 - v3 * dctSin6 + 2048) >> 12;
				v3 = t;
				t = (v4 - v6 + 1) >> 1;
				v4 = (v4 + v6 + 1) >> 1;
				v6 = t;
				t = (v7 + v5 + 1) >> 1;
				v5 = (v7 - v5 + 1) >> 1;
				v7 = t;

				// stage 2
				t = (v0 - v3 + 1) >> 1;
				v0 = (v0 + v3 + 1) >> 1;
				v3 = t;
				t = (v1 - v2 + 1) >> 1;
				v1 = (v1 + v2 + 1) >> 1;
				v2 = t;
				t = (v4 * dctSin3 + v7 * dctCos3 + 2048) >> 12;
				v4 = (v4 * dctCos3 - v7 * dctSin3 + 2048) >> 12;
				v7 = t;
				t = (v5 * dctSin1 + v6 * dctCos1 + 2048) >> 12;
				v5 = (v5 * dctCos1 - v6 * dctSin1 + 2048) >> 12;
				v6 = t;

				// stage 1
				p[0 * 8 + col] = v0 + v7;
				p[7 * 8 + col] = v0 - v7;
				p[1 * 8 + col] = v1 + v6;
				p[6 * 8 + col] = v1 - v6;
				p[2 * 8 + col] = v2 + v5;
				p[5 * 8 + col] = v2 - v5;
				p[3 * 8 + col] = v3 + v4;
				p[4 * 8 + col] = v3 - v4;
			}

			// convert to 8-bit integers
			for (i = 0; i < 64; ++i) {
				const sample = 128 + ((p[i] + 8) >> 4);
				dataOut[i] = sample < 0 ? 0 : sample > 0xff ? 0xff : sample;
			}
		}

		JpegImage.requestMemoryAllocation(samplesPerLine * blocksPerColumn * 8);

		// let i, j;

		for (let blockRow = 0; blockRow < blocksPerColumn; blockRow++) {
			const scanLine = blockRow << 3;

			for (let i = 0; i < 8; i++) {
				lines.push(new Uint8Array(samplesPerLine));
			}

			for (let blockCol = 0; blockCol < blocksPerLine; blockCol++) {
				quantizeAndInverse(component.blocks[blockRow][blockCol], r, R);

				let offset = 0;
				const sample = blockCol << 3;

				for (let j = 0; j < 8; j++) {
					const line = lines[scanLine + j];

					for (let i = 0; i < 8; i++) {
						line[sample + i] = r[offset++];
					}
				}
			}
		}

		return lines;
	}

	public clampTo8bit(a: number): number {
		return a < 0 ? 0 : a > 255 ? 255 : a;
	}

	// constructor.prototype = {

	// public load(path: string): void {
	// 	let xhr = new XMLHttpRequest();
	// 	xhr.open('GET', path, true);
	// 	xhr.responseType = 'arraybuffer';
	// 	xhr.onload = function () {
	// 		// TODO catch parse error
	// 		let data = new Uint8Array(xhr.response || xhr.mozResponseArrayBuffer);
	// 		this.parse(data);
	// 		if (this.onload) this.onload();
	// 	}.bind(this);
	// 	xhr.send(null);
	// }

	public parse(data: Uint8Array): void {
		if (typeof this.opts.maxResolutionInMP == 'undefined') {
			throw new Error('parse() : this.opts.maxResolutionInMP is undefined');
		}

		const maxResolutionInPixels = this.opts.maxResolutionInMP * 1000 * 1000;
		let offset = 0; /*,
			length = data.length */

		function readUint16(): number {
			const value = (data[offset] << 8) | data[offset + 1];

			offset += 2;

			return value;
		}

		function readDataBlock(): Uint8Array {
			const length = readUint16();
			const array = data.subarray(offset, offset + length - 2);

			offset += array.length;

			return array;
		}

		function prepareComponents(frame: IFrame): void {
			let maxH = 0,
				maxV = 0;
			let component, componentId;

			for (componentId in frame.components) {
				// if (frame.components.hasOwnProperty(componentId)) {
				if (Object.prototype.hasOwnProperty.call(frame.components, componentId)) {
					component = frame.components[componentId];

					if (maxH < component.h) {
						maxH = component.h;
					}

					if (maxV < component.v) {
						maxV = component.v;
					}
				}
			}

			const mcusPerLine = Math.ceil(frame.samplesPerLine / 8 / maxH);
			const mcusPerColumn = Math.ceil(frame.scanLines / 8 / maxV);

			for (componentId in frame.components) {
				// if (frame.components.hasOwnProperty(componentId)) {
				if (Object.prototype.hasOwnProperty.call(frame.components, componentId)) {
					component = frame.components[componentId];

					const blocksPerLine = Math.ceil(
						(Math.ceil(frame.samplesPerLine / 8) * component.h) / maxH
					);
					const blocksPerColumn = Math.ceil(
						(Math.ceil(frame.scanLines / 8) * component.v) / maxV
					);
					const blocksPerLineForMcu = mcusPerLine * component.h;
					const blocksPerColumnForMcu = mcusPerColumn * component.v;
					const blocksToAllocate = blocksPerColumnForMcu * blocksPerLineForMcu;
					const blocks = [];

					// Each block is a Int32Array of length 64 (4 x 64 = 256 bytes)
					JpegImage.requestMemoryAllocation(blocksToAllocate * 256);

					for (let i = 0; i < blocksPerColumnForMcu; i++) {
						const row = [];

						for (let j = 0; j < blocksPerLineForMcu; j++) {
							row.push(new Int32Array(64));
						}

						blocks.push(row);
					}

					component.blocksPerLine = blocksPerLine;
					component.blocksPerColumn = blocksPerColumn;
					component.blocks = blocks;
				}
			}

			frame.maxH = maxH;
			frame.maxV = maxV;
			frame.mcusPerLine = mcusPerLine;
			frame.mcusPerColumn = mcusPerColumn;
		}

		let jfif = defaultJFIFValue;
		let adobe = defaultAdobeValue;
		// let pixels = null;
		let frame = defaultIFrame,
			resetInterval = 0;
		const quantizationTables = [],
			frames = [];
		const huffmanTablesAC: HuffmanTable[] = [],
			huffmanTablesDC: HuffmanTable[] = [];
		let fileMarker = readUint16();
		let malformedDataOffset = -1;
		let appData: Uint8Array;
		let quantizationTablesLength: number;
		let quantizationTablesEnd: number;

		this.comments = [];

		if (fileMarker != 0xffd8) {
			// SOI (Start of Image)
			throw new Error('SOI not found');
		}

		fileMarker = readUint16();

		while (fileMarker != 0xffd9) {
			// EOI (End of image)
			let i: number; //, j: number; // , l;
			let pixelsInFrame: number;
			let componentsCount: number;
			let huffmanLength: number;
			let selectorsCount: number;
			let components: Component[];
			let spectralStart: number;
			let spectralEnd: number;
			let successiveApproximation: number;
			let processed: number;

			switch (fileMarker) {
				case 0xff00:
					break;

				case 0xffe0: // APP0 (Application Specific)
				case 0xffe1: // APP1
				case 0xffe2: // APP2
				case 0xffe3: // APP3
				case 0xffe4: // APP4
				case 0xffe5: // APP5
				case 0xffe6: // APP6
				case 0xffe7: // APP7
				case 0xffe8: // APP8
				case 0xffe9: // APP9
				case 0xffea: // APP10
				case 0xffeb: // APP11
				case 0xffec: // APP12
				case 0xffed: // APP13
				case 0xffee: // APP14
				case 0xffef: // APP15
				case 0xfffe: // COM (Comment)
					appData = readDataBlock();

					if (fileMarker === 0xfffe) {
						const comment = String.fromCharCode.apply(null, Array.from(appData));

						this.comments.push(comment);
					}

					if (fileMarker === 0xffe0) {
						if (
							appData[0] === 0x4a &&
							appData[1] === 0x46 &&
							appData[2] === 0x49 &&
							appData[3] === 0x46 &&
							appData[4] === 0
						) {
							// 'JFIF\x00'
							jfif = {
								version: { major: appData[5], minor: appData[6] },
								densityUnits: appData[7],
								xDensity: (appData[8] << 8) | appData[9],
								yDensity: (appData[10] << 8) | appData[11],
								thumbWidth: appData[12],
								thumbHeight: appData[13],
								thumbData: appData.subarray(
									14,
									14 + 3 * appData[12] * appData[13]
								)
							};
						}
					}

					// TODO APP1 - Exif
					if (fileMarker === 0xffe1) {
						if (
							appData[0] === 0x45 &&
							appData[1] === 0x78 &&
							appData[2] === 0x69 &&
							appData[3] === 0x66 &&
							appData[4] === 0
						) {
							// 'EXIF\x00'
							this.exifBuffer = appData.subarray(5, appData.length);
						}
					}

					if (fileMarker === 0xffee) {
						if (
							appData[0] === 0x41 &&
							appData[1] === 0x64 &&
							appData[2] === 0x6f &&
							appData[3] === 0x62 &&
							appData[4] === 0x65 &&
							appData[5] === 0
						) {
							// 'Adobe\x00'
							adobe = {
								version: appData[6],
								flags0: (appData[7] << 8) | appData[8],
								flags1: (appData[9] << 8) | appData[10],
								transformCode: appData[11]
							};
						}
					}
					break;

				case 0xffdb: // DQT (Define Quantization Tables)
					quantizationTablesLength = readUint16();
					quantizationTablesEnd = quantizationTablesLength + offset - 2;

					while (offset < quantizationTablesEnd) {
						const quantizationTableSpec = data[offset++];

						JpegImage.requestMemoryAllocation(64 * 4);

						const tableData = new Int32Array(64);

						if (quantizationTableSpec >> 4 === 0) {
							// 8 bit values
							for (let j = 0; j < 64; j++) {
								const z = dctZigZag[j];

								tableData[z] = data[offset++];
							}
						} else if (quantizationTableSpec >> 4 === 1) {
							// 16 bit
							for (let j = 0; j < 64; j++) {
								const z = dctZigZag[j];

								tableData[z] = readUint16();
							}
						} else {
							throw new Error('DQT: invalid table spec');
						}

						quantizationTables[quantizationTableSpec & 15] = tableData;
					}
					break;

				case 0xffc0: // SOF0 (Start of Frame, Baseline DCT)
				case 0xffc1: // SOF1 (Start of Frame, Extended DCT)
				case 0xffc2: // SOF2 (Start of Frame, Progressive DCT)
					readUint16(); // skip data length
					frame = {
						extended: fileMarker === 0xffc1,
						progressive: fileMarker === 0xffc2,
						// BEGIN TODO: Enforce in-order execution:
						precision: data[offset++],
						scanLines: readUint16(),
						samplesPerLine: readUint16(),
						// END
						// components: {},
						components: [],
						componentsOrder: [],
						mcusPerLine: 0,
						mcusPerColumn: 0,
						maxH: 0,
						maxV: 0
					};

					pixelsInFrame = frame.scanLines * frame.samplesPerLine;

					if (pixelsInFrame > maxResolutionInPixels) {
						const exceededAmount = Math.ceil(
							(pixelsInFrame - maxResolutionInPixels) / 1e6
						);

						throw new Error(
							`maxResolutionInMP limit exceeded by ${exceededAmount}MP`
						);
					}

					componentsCount = data[offset++];

					// let componentId;
					// let maxH = 0,
					// 	maxV = 0;

					for (i = 0; i < componentsCount; i++) {
						const componentId = data[offset];
						const h = data[offset + 1] >> 4;
						const v = data[offset + 1] & 15;
						const qId = data[offset + 2];

						frame.componentsOrder.push(componentId);
						frame.components[componentId] = {
							h: h,
							v: v,
							quantizationIdx: qId,
							pred: 0,
							quantizationTable: new Int32Array(),
							blocks: [],
							blocksPerLine: 0,
							blocksPerColumn: 0,
							huffmanTableAC: [],
							huffmanTableDC: [],
							lines: [],
							scaleX: 0,
							scaleY: 0
						};
						offset += 3;
					}

					prepareComponents(frame);
					frames.push(frame);
					break;

				case 0xffc4: // DHT (Define Huffman Tables)
					huffmanLength = readUint16();

					for (i = 2; i < huffmanLength; ) {
						const huffmanTableSpec = data[offset++];
						const codeLengths = new Uint8Array(16);
						let codeLengthSum = 0;
						for (let j = 0; j < 16; j++, offset++) {
							codeLengthSum += codeLengths[j] = data[offset];
						}
						JpegImage.requestMemoryAllocation(16 + codeLengthSum);
						const huffmanValues = new Uint8Array(codeLengthSum);
						for (let j = 0; j < codeLengthSum; j++, offset++)
							huffmanValues[j] = data[offset];
						i += 17 + codeLengthSum;

						(huffmanTableSpec >> 4 === 0 ? huffmanTablesDC : huffmanTablesAC)[
							huffmanTableSpec & 15
						] = this.buildHuffmanTable(codeLengths, huffmanValues);
					}
					break;

				case 0xffdd: // DRI (Define Restart Interval)
					readUint16(); // skip data length
					resetInterval = readUint16();
					break;

				case 0xffdc: // Number of Lines marker
					readUint16(); // skip data length
					readUint16(); // Ignore this data since it represents the image height
					break;

				case 0xffda: // SOS (Start of Scan)
					/* let scanLength = */ readUint16();
					selectorsCount = data[offset++];
					components = [];
					// let component;

					for (i = 0; i < selectorsCount; i++) {
						const component = frame.components[data[offset++]];
						const tableSpec = data[offset++];
						component.huffmanTableDC = huffmanTablesDC[tableSpec >> 4];
						component.huffmanTableAC = huffmanTablesAC[tableSpec & 15];
						components.push(component);
					}

					spectralStart = data[offset++];
					spectralEnd = data[offset++];
					successiveApproximation = data[offset++];
					processed = this.decodeScan(
						data,
						offset,
						frame,
						components,
						resetInterval,
						spectralStart,
						spectralEnd,
						successiveApproximation >> 4,
						successiveApproximation & 15,
						this.opts
					);
					offset += processed;
					break;

				case 0xffff: // Fill bytes
					if (data[offset] !== 0xff) {
						// Avoid skipping a valid marker.
						offset--;
					}

					break;

				default:
					if (
						data[offset - 3] == 0xff &&
						data[offset - 2] >= 0xc0 &&
						data[offset - 2] <= 0xfe
					) {
						// could be incorrect encoding -- last 0xFF byte of the previous
						// block was eaten by the encoder
						offset -= 3;
						break;
					} else if (fileMarker === 0xe0 || fileMarker == 0xe1) {
						// Recover from malformed APP1 markers popular in some phone models.
						// See https://github.com/eugeneware/jpeg-js/issues/82

						if (malformedDataOffset !== -1) {
							throw new Error(
								`first unknown JPEG marker at offset ${malformedDataOffset.toString(
									16
								)}, second unknown JPEG marker ${fileMarker.toString(
									16
								)} at offset ${(offset - 1).toString(16)}`
							);
						}

						malformedDataOffset = offset - 1;

						const nextOffset = readUint16();

						if (data[offset + nextOffset - 2] === 0xff) {
							offset += nextOffset - 2;
							break;
						}
					}

					throw new Error('unknown JPEG marker ' + fileMarker.toString(16));
			}

			fileMarker = readUint16();
		}

		if (frames.length !== 1) {
			throw new Error('only single frame JPEGs supported');
		}

		// set each frame's components quantization table

		for (let i = 0; i < frames.length; i++) {
			const cp = frames[i].components;

			for (const j in cp) {
				const k = cp[j].quantizationIdx;

				if (typeof k !== 'undefined') {
					cp[j].quantizationTable = quantizationTables[k];
				}

				delete cp[j].quantizationIdx;
			}
		}

		this.width = frame.samplesPerLine;
		this.height = frame.scanLines;
		this.jfif = jfif;
		this.adobe = adobe;
		this.components = [];

		for (let i = 0; i < frame.componentsOrder.length; i++) {
			const component = frame.components[frame.componentsOrder[i]];

			this.components.push({
				lines: this.buildComponentData(frame, component),
				scaleX: component.h / frame.maxH,
				scaleY: component.v / frame.maxV,
				h: 0,
				v: 0,
				pred: 0,
				quantizationTable: new Int32Array(),
				quantizationIdx: 0,
				blocks: [],
				blocksPerLine: 0,
				blocksPerColumn: 0,
				huffmanTableAC: [],
				huffmanTableDC: []
			});
		}
	}

	public getData(width: number, height: number): Uint8Array {
		const scaleX = this.width / width,
			scaleY = this.height / height;

		let component1, component2, component3, component4;
		let component1Line, component2Line, component3Line, component4Line;
		let x, y;
		let offset = 0;
		let Y, Cb, Cr, K, C, M, Ye, R, G, B;
		let colorTransform;
		const dataLength = width * height * this.components.length;
		JpegImage.requestMemoryAllocation(dataLength);
		const data = new Uint8Array(dataLength);

		switch (this.components.length) {
			case 1:
				component1 = this.components[0];
				for (y = 0; y < height; y++) {
					component1Line = component1.lines[0 | (y * component1.scaleY * scaleY)];
					for (x = 0; x < width; x++) {
						Y = component1Line[0 | (x * component1.scaleX * scaleX)];

						data[offset++] = Y;
					}
				}
				break;
			case 2:
				// PDF might compress two component data in custom colorspace
				component1 = this.components[0];
				component2 = this.components[1];
				for (y = 0; y < height; y++) {
					component1Line = component1.lines[0 | (y * component1.scaleY * scaleY)];
					component2Line = component2.lines[0 | (y * component2.scaleY * scaleY)];
					for (x = 0; x < width; x++) {
						Y = component1Line[0 | (x * component1.scaleX * scaleX)];
						data[offset++] = Y;
						Y = component2Line[0 | (x * component2.scaleX * scaleX)];
						data[offset++] = Y;
					}
				}
				break;
			case 3:
				// The default transform for three components is true
				colorTransform = true;
				// The adobe transform marker overrides any previous setting
				if (this.adobe && this.adobe.transformCode) colorTransform = true;
				else if (typeof this.opts.colorTransform !== 'undefined')
					colorTransform = !!this.opts.colorTransform;

				component1 = this.components[0];
				component2 = this.components[1];
				component3 = this.components[2];
				for (y = 0; y < height; y++) {
					component1Line = component1.lines[0 | (y * component1.scaleY * scaleY)];
					component2Line = component2.lines[0 | (y * component2.scaleY * scaleY)];
					component3Line = component3.lines[0 | (y * component3.scaleY * scaleY)];
					for (x = 0; x < width; x++) {
						if (!colorTransform) {
							R = component1Line[0 | (x * component1.scaleX * scaleX)];
							G = component2Line[0 | (x * component2.scaleX * scaleX)];
							B = component3Line[0 | (x * component3.scaleX * scaleX)];
						} else {
							Y = component1Line[0 | (x * component1.scaleX * scaleX)];
							Cb = component2Line[0 | (x * component2.scaleX * scaleX)];
							Cr = component3Line[0 | (x * component3.scaleX * scaleX)];

							R = this.clampTo8bit(Y + 1.402 * (Cr - 128));
							G = this.clampTo8bit(
								Y - 0.3441363 * (Cb - 128) - 0.71413636 * (Cr - 128)
							);
							B = this.clampTo8bit(Y + 1.772 * (Cb - 128));
						}

						data[offset++] = R;
						data[offset++] = G;
						data[offset++] = B;
					}
				}
				break;
			case 4:
				if (!this.adobe) throw new Error('Unsupported color mode (4 components)');
				// The default transform for four components is false
				colorTransform = false;
				// The adobe transform marker overrides any previous setting
				if (this.adobe && this.adobe.transformCode) colorTransform = true;
				else if (typeof this.opts.colorTransform !== 'undefined')
					colorTransform = !!this.opts.colorTransform;

				component1 = this.components[0];
				component2 = this.components[1];
				component3 = this.components[2];
				component4 = this.components[3];
				for (y = 0; y < height; y++) {
					component1Line = component1.lines[0 | (y * component1.scaleY * scaleY)];
					component2Line = component2.lines[0 | (y * component2.scaleY * scaleY)];
					component3Line = component3.lines[0 | (y * component3.scaleY * scaleY)];
					component4Line = component4.lines[0 | (y * component4.scaleY * scaleY)];
					for (x = 0; x < width; x++) {
						if (!colorTransform) {
							C = component1Line[0 | (x * component1.scaleX * scaleX)];
							M = component2Line[0 | (x * component2.scaleX * scaleX)];
							Ye = component3Line[0 | (x * component3.scaleX * scaleX)];
							K = component4Line[0 | (x * component4.scaleX * scaleX)];
						} else {
							Y = component1Line[0 | (x * component1.scaleX * scaleX)];
							Cb = component2Line[0 | (x * component2.scaleX * scaleX)];
							Cr = component3Line[0 | (x * component3.scaleX * scaleX)];
							K = component4Line[0 | (x * component4.scaleX * scaleX)];

							C = 255 - this.clampTo8bit(Y + 1.402 * (Cr - 128));
							M =
								255 -
								this.clampTo8bit(
									Y - 0.3441363 * (Cb - 128) - 0.71413636 * (Cr - 128)
								);
							Ye = 255 - this.clampTo8bit(Y + 1.772 * (Cb - 128));
						}
						data[offset++] = 255 - C;
						data[offset++] = 255 - M;
						data[offset++] = 255 - Ye;
						data[offset++] = 255 - K;
					}
				}
				break;

			default:
				throw new Error('Unsupported color mode');
		}

		return data;
	}

	public copyToImageData(
		imageData: RawImageData<BufferLike> & { comments?: string[]; exifBuffer?: Uint8Array },
		formatAsRGBA: boolean | undefined
	): void {
		const width = imageData.width,
			height = imageData.height;
		const imageDataArray = imageData.data;
		const data = this.getData(width, height);
		let i = 0,
			j = 0,
			x,
			y;
		let Y, K, C, M, R, G, B;
		switch (this.components.length) {
			case 1:
				for (y = 0; y < height; y++) {
					for (x = 0; x < width; x++) {
						Y = data[i++];

						imageDataArray[j++] = Y;
						imageDataArray[j++] = Y;
						imageDataArray[j++] = Y;
						if (formatAsRGBA) {
							imageDataArray[j++] = 255;
						}
					}
				}
				break;
			case 3:
				for (y = 0; y < height; y++) {
					for (x = 0; x < width; x++) {
						R = data[i++];
						G = data[i++];
						B = data[i++];

						imageDataArray[j++] = R;
						imageDataArray[j++] = G;
						imageDataArray[j++] = B;
						if (formatAsRGBA) {
							imageDataArray[j++] = 255;
						}
					}
				}
				break;
			case 4:
				for (y = 0; y < height; y++) {
					for (x = 0; x < width; x++) {
						C = data[i++];
						M = data[i++];
						Y = data[i++];
						K = data[i++];

						R = 255 - this.clampTo8bit(C * (1 - K / 255) + K);
						G = 255 - this.clampTo8bit(M * (1 - K / 255) + K);
						B = 255 - this.clampTo8bit(Y * (1 - K / 255) + K);

						imageDataArray[j++] = R;
						imageDataArray[j++] = G;
						imageDataArray[j++] = B;
						if (formatAsRGBA) {
							imageDataArray[j++] = 255;
						}
					}
				}
				break;
			default:
				throw new Error('Unsupported color mode');
		}
	}
	// };

	// We cap the amount of memory used by jpeg-js to avoid unexpected OOMs from untrusted content.

	public static totalBytesAllocated = 0;
	public static maxMemoryUsageBytes = 0;

	public static requestMemoryAllocation(increaseAmount = 0): void {
		const totalMemoryImpactBytes = this.totalBytesAllocated + increaseAmount;

		if (totalMemoryImpactBytes > this.maxMemoryUsageBytes) {
			const exceededAmount = Math.ceil(
				(totalMemoryImpactBytes - this.maxMemoryUsageBytes) / 1024 / 1024
			);

			throw new Error(
				`maxMemoryUsageInMB limit exceeded by at least ${exceededAmount}MB`
			);
		}

		this.totalBytesAllocated = totalMemoryImpactBytes;
	}

	public static resetMaxMemoryUsage(maxMemoryUsageBytes_: number): void {
		this.totalBytesAllocated = 0;
		this.maxMemoryUsageBytes = maxMemoryUsageBytes_;
	}

	public static getBytesAllocated(): number {
		return this.totalBytesAllocated;
	}

	// constructor.requestMemoryAllocation = requestMemoryAllocation;

	// return constructor;
}
// )();

// if (typeof module !== 'undefined') {
// 	module.exports = decode;
// } else if (typeof window !== 'undefined') {
// 	window['jpeg-js'] = window['jpeg-js'] || {};
// 	window['jpeg-js'].decode = decode;
// }

// decode(jpegData, userOpts = {})
export function decode(
	jpegData: BufferLike,
	userOpts: IDecoderOptions = {}
): UintArrRet & { comments?: string[] } {
	const opts = { ...defaultOpts, ...userOpts };
	const arr = new Uint8Array(jpegData);
	const decoder = new JpegImage();
	decoder.opts = opts;
	// If this constructor ever supports async decoding this will need to be done differently.
	// Until then, treating as singleton limit is fine.
	if (typeof opts.maxMemoryUsageInMB !== 'undefined') {
		JpegImage.resetMaxMemoryUsage(opts.maxMemoryUsageInMB * 1024 * 1024);
	}

	decoder.parse(arr);

	const channels = opts.formatAsRGBA ? 4 : 3;
	const bytesNeeded = decoder.width * decoder.height * channels;
	let image: RawImageData<BufferLike> & { comments?: string[]; exifBuffer?: Uint8Array };

	try {
		JpegImage.requestMemoryAllocation(bytesNeeded);
		image = {
			width: decoder.width,
			height: decoder.height,
			exifBuffer: decoder.exifBuffer,
			data: opts.useTArray ? new Uint8Array(bytesNeeded) : Buffer.alloc(bytesNeeded),
			comments: undefined
		};
		if (decoder.comments.length > 0) {
			image.comments = decoder.comments;
		}
	} catch (err) {
		if (err instanceof RangeError) {
			throw new Error(
				'Could not allocate enough memory for the image. ' + 'Required: ' + bytesNeeded
			);
		}

		if (err instanceof ReferenceError) {
			if (err.message === 'Buffer is not defined') {
				throw new Error(
					'Buffer is not globally defined in this environment. ' +
						'Consider setting useTArray to true'
				);
			}
		}
		throw err;
	}

	decoder.copyToImageData(image, opts.formatAsRGBA);

	return image;
}
