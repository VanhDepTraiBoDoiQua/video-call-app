import {defineConfig} from "vite";

export default defineConfig({
    root: ".",              // index.html nằm ở client/
    server: {port: 5173}, // hoặc cổng tùy bạn
});