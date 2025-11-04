// Các filter effects cho video processing
export const Filters = {
    // Filter đen trắng (grayscale)
    blackwhite(ctx, width, height) {
        const imageData = ctx.getImageData(0, 0, width, height);
        const data = imageData.data;

        for (let i = 0; i < data.length; i += 4) {
            // Công thức grayscale chuẩn
            const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
            data[i] = gray;     // Red
            data[i + 1] = gray; // Green
            data[i + 2] = gray; // Blue
            // data[i + 3] là alpha, giữ nguyên
        }

        ctx.putImageData(imageData, 0, 0);
    },

    // Filter làm mờ (blur)
    blur(ctx) {
        ctx.filter = 'blur(5px)';
        const imageData = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
        ctx.putImageData(imageData, 0, 0);
        ctx.filter = 'none';
    },

    // Filter sepia (tông nâu cổ điển)
    sepia(ctx, width, height) {
        const imageData = ctx.getImageData(0, 0, width, height);
        const data = imageData.data;

        for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];

            data[i] = Math.min(255, (r * 0.393) + (g * 0.769) + (b * 0.189));
            data[i + 1] = Math.min(255, (r * 0.349) + (g * 0.686) + (b * 0.168));
            data[i + 2] = Math.min(255, (r * 0.272) + (g * 0.534) + (b * 0.131));
        }

        ctx.putImageData(imageData, 0, 0);
    },

    // Filter đảo màu (invert)
    invert(ctx, width, height) {
        const imageData = ctx.getImageData(0, 0, width, height);
        const data = imageData.data;

        for (let i = 0; i < data.length; i += 4) {
            data[i] = 255 - data[i];         // Red
            data[i + 1] = 255 - data[i + 1]; // Green
            data[i + 2] = 255 - data[i + 2]; // Blue
        }

        ctx.putImageData(imageData, 0, 0);
    },

    // Filter tăng độ sáng (brightness)
    brightness(ctx, width, height) {
        const imageData = ctx.getImageData(0, 0, width, height);
        const data = imageData.data;
        const brightness = 50; // Tăng 50 điểm sáng

        for (let i = 0; i < data.length; i += 4) {
            data[i] = Math.min(255, data[i] + brightness);
            data[i + 1] = Math.min(255, data[i + 1] + brightness);
            data[i + 2] = Math.min(255, data[i + 2] + brightness);
        }

        ctx.putImageData(imageData, 0, 0);
    },

    // Filter viền cạnh (edge detection) - Nâng cao
    edge(ctx, width, height) {
        const imageData = ctx.getImageData(0, 0, width, height);
        const data = imageData.data;
        const output = new Uint8ClampedArray(data.length);

        // Sobel kernel
        const sobelX = [
            [-1, 0, 1],
            [-2, 0, 2],
            [-1, 0, 1]
        ];
        const sobelY = [
            [-1, -2, -1],
            [0, 0, 0],
            [1, 2, 1]
        ];

        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                let gx = 0, gy = 0;

                // Áp dụng Sobel kernel
                for (let ky = -1; ky <= 1; ky++) {
                    for (let kx = -1; kx <= 1; kx++) {
                        const idx = ((y + ky) * width + (x + kx)) * 4;
                        const gray = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];

                        gx += gray * sobelX[ky + 1][kx + 1];
                        gy += gray * sobelY[ky + 1][kx + 1];
                    }
                }

                const magnitude = Math.sqrt(gx * gx + gy * gy);
                const idx = (y * width + x) * 4;

                output[idx] = magnitude;
                output[idx + 1] = magnitude;
                output[idx + 2] = magnitude;
                output[idx + 3] = 255;
            }
        }

        const newImageData = new ImageData(output, width, height);
        ctx.putImageData(newImageData, 0, 0);
    },

    // Không áp dụng filter
    none(ctx, width, height) {
        // Không làm gì cả
    }
};

// Export để sử dụng trong các file khác
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Filters;
}