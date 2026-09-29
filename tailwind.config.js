/** Couleurs et typographies reprises du logo Directline. */
module.exports = {
  content: ['index.html', 'assets/app.js'],
  theme: {
    extend: {
      colors: {
        brand: {
          navy: '#003a90',   // « Direct »
          blue: '#0a67c9',   // arcs et drapeau RDC
          sky: '#eaf2fc',
          red: '#e02010',    // drapeau Chine
          orange: '#f07a12',
          yellow: '#f9c20a', // étoiles
          ink: '#3b424d',    // « line »
          night: '#021c4a',
        },
      },
      fontFamily: {
        display: ['"Exo 2"', 'system-ui', 'sans-serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
};
