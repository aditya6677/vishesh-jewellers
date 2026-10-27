'use strict';

const families = [
  ['cormorant-garamond', 'Cormorant Garamond', [400, 500, 600, 700]],
  ['jost', 'Jost', [300, 400, 500, 600, 700]],
  ['ibm-plex-mono', 'IBM Plex Mono', [400, 500, 600]]
];
const fonts = families.flatMap(([packageName, family, weights]) => weights.map(weight => ({ packageName, family, weight, style: 'normal', file: `${packageName}-latin-${weight}-normal.woff2` })));
fonts.push({ packageName: 'cormorant-garamond', family: 'Cormorant Garamond', weight: 500, style: 'italic', file: 'cormorant-garamond-latin-500-italic.woff2' });
module.exports = Object.freeze(fonts.map(Object.freeze));
