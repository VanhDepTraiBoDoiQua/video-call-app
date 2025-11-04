import {Filters} from "./filters.js";

// Video Processor với WebCodecs API
export class VideoProcessor {
    constructor() {
        this.processor = null;
        this.generator = null;
        this.reader = null;
        this.writer = null;
        this.isProcessing = false;
        this.currentFilter = 'none';
        this.canvas = document.getElementById('processCanvas');
        this.ctx = this.canvas.getContext('2d', {
            willReadFrequently: true,
            desynchronized: true
        });
        this.frameCount = 0;
        this.lastFrameTime = 0;
    }

    /**
     * Bắt đầu xử lý video track
     * @param {MediaStreamTrack} videoTrack - Track video từ camera
     * @returns {MediaStreamTrack} - Track video đã được xử lý
     */
    async start(videoTrack) {
        console.log('Starting video processor...');

        if (this.isProcessing) {
            await this.stop();
        }

        try {
            // Kiểm tra browser support
            if (!window.MediaStreamTrackProcessor || !window.MediaStreamTrackGenerator) {
                console.warn('WebCodecs API not supported, using original track');
                return videoTrack;
            }

            // Tạo processor để đọc frames từ track gốc
            this.processor = new MediaStreamTrackProcessor({track: videoTrack});
            this.reader = this.processor.readable.getReader();

            // Tạo generator để tạo track mới với frames đã xử lý
            this.generator = new MediaStreamTrackGenerator({kind: 'video'});
            this.writer = this.generator.writable.getWriter();

            this.isProcessing = true;
            this.lastFrameTime = performance.now();

            // Bắt đầu vòng lặp xử lý frames
            this.processFrames();

            console.log('Video processor started successfully');
            return this.generator;

        } catch (error) {
            console.error('Error starting video processor:', error);
            return videoTrack; // Fallback về track gốc
        }
    }

    /**
     * Vòng lặp xử lý từng frame
     */
    async processFrames() {
        while (this.isProcessing) {
            try {
                const {done, value: frame} = await this.reader.read();

                if (done) {
                    console.log('Frame stream ended');
                    break;
                }

                // Tính FPS (optional)
                this.frameCount++;
                const now = performance.now();
                if (now - this.lastFrameTime >= 1000) {
                    // console.log(`Processing FPS: ${this.frameCount}`);
                    this.frameCount = 0;
                    this.lastFrameTime = now;
                }

                // Xử lý frame với filter hiện tại
                const processedFrame = await this.applyFilter(frame);

                // Ghi frame đã xử lý vào generator
                if (this.writer) {
                    await this.writer.write(processedFrame);
                }

                // Đóng frame gốc để giải phóng bộ nhớ (quan trọng!)
                frame.close();

            } catch (error) {
                if (error.name === 'AbortError') {
                    console.log('Frame processing aborted');
                } else {
                    console.error('Error processing frame:', error);
                }
                break;
            }
        }

        console.log('Frame processing loop ended');
    }

    /**
     * Áp dụng filter lên frame
     * @param {VideoFrame} frame - Frame video gốc
     * @returns {VideoFrame} - Frame đã được xử lý
     */
    async applyFilter(frame) {
        // Nếu không có filter, trả về frame gốc
        if (this.currentFilter === 'none') {
            return frame;
        }

        try {
            // Set canvas size theo frame
            this.canvas.width = frame.displayWidth;
            this.canvas.height = frame.displayHeight;

            // Vẽ frame lên canvas
            this.ctx.drawImage(frame, 0, 0);

            // Áp dụng filter tương ứng
            if (Filters[this.currentFilter]) {
                Filters[this.currentFilter](
                    this.ctx,
                    this.canvas.width,
                    this.canvas.height
                );
            }

            // Tạo VideoFrame mới từ canvas đã xử lý
            const processedFrame = new VideoFrame(this.canvas, {
                timestamp: frame.timestamp,
                alpha: 'discard' // Không cần alpha channel
            });

            return processedFrame;

        } catch (error) {
            console.error('Error applying filter:', error);
            return frame; // Fallback về frame gốc
        }
    }

    /**
     * Thay đổi filter
     * @param {string} filterName - Tên filter (none, blackwhite, blur, sepia, etc.)
     */
    setFilter(filterName) {
        console.log('Setting filter to:', filterName);
        this.currentFilter = filterName;
    }

    /**
     * Lấy filter hiện tại
     * @returns {string} - Tên filter hiện tại
     */
    getCurrentFilter() {
        return this.currentFilter;
    }

    /**
     * Dừng xử lý video
     */
    async stop() {
        console.log('Stopping video processor...');
        this.isProcessing = false;

        try {
            if (this.reader) {
                await this.reader.cancel();
                this.reader.releaseLock();
                this.reader = null;
            }

            if (this.writer) {
                await this.writer.close();
                this.writer = null;
            }

            if (this.processor) {
                this.processor = null;
            }

            if (this.generator) {
                this.generator = null;
            }

            console.log('Video processor stopped');

        } catch (error) {
            console.error('Error stopping video processor:', error);
        }
    }

    /**
     * Kiểm tra xem processor có đang chạy không
     * @returns {boolean}
     */
    isRunning() {
        return this.isProcessing;
    }
}

// Export để sử dụng trong các file khác
if (typeof module !== 'undefined' && module.exports) {
    module.exports = VideoProcessor;
}