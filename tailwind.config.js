/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{html,js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        "pixelify": ["Pixelify Sans", "monospace"],
        "pingfang": ["PingFang HK", "sans-serif"],
      },
      height: {
        'screen-dvh': '100dvh',
      },
    },
  },
  plugins: [],
};
