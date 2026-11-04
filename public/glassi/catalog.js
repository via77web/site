/* GLASSI catalogue. Version = geometry, finish = colour. Source: brand system 02 product-manifest.json.
   Only Version 2 has verified commercial data (observed on the live site). Version 1 is unconfirmed: no price, no finishes, no 3D. */

export const FRAMES = [
  { name: 'Pearl silver', hex: '#d3dde1', facet: '#a9b8be', metal: .92, rough: .22, coat: .6, irid: .25 },
  { name: 'Graphite', hex: '#3a4347', facet: '#262d31', metal: .85, rough: .3, coat: .5, irid: 0 },
  { name: 'Warm ivory', hex: '#ede4d0', facet: '#d9ccb2', metal: 0, rough: .38, coat: 1, irid: 0 },
  { name: 'Lavender haze', hex: '#bcaed8', facet: '#a393c6', metal: 0, rough: .36, coat: 1, irid: .1 },
  { name: 'Wildfire', hex: '#e0763f', facet: '#c46131', metal: 0, rough: .34, coat: 1, irid: 0 },
];
export const LENSES = [
  { name: 'Smoke blue', hex: '#20394a', tint: '#3d6f8a', mirror: false },
  { name: 'Rose', hex: '#6e2b3d', tint: '#b0566e', mirror: false },
  { name: 'Olive', hex: '#36422c', tint: '#6d7d4f', mirror: false },
  { name: 'Silver mirror', hex: '#c6d0d4', tint: '#7d8a90', mirror: true },
];

export const COLLECTION = 'Afterparty';

export const PRODUCTS = {
  'version-1': {
    id: 'version-1', label: 'Version 1',
    summary: 'Sharper swept cat-eye. Angular upper edge, silver body, a recessed channel along the temple.',
    shape: 'Swept cat-eye, angular brow',
    shownIn: 'Silver frame, smoke-blue lens',
    price: null,              // unconfirmed
    frames: null, lenses: null,
    glb: null,                // no approved model yet: never borrow Version 2's mesh
    product: 'brand/product/version-1',
    sheet: 'brand/product/version-1-design-sheet.webp',
    views: { front: 'brand/product/version-1-front', side: 'brand/product/version-1-side' },
    temples: null,
    alt: 'Angular silver wrap cat-eye sunglasses with dark smoke-blue lenses',
  },
  'version-2': {
    id: 'version-2', label: 'Version 2',
    summary: 'Softer wrap. Rounded lower lens line and broad smooth arms, plain or with glassi engraved just behind the hinge.',
    shape: 'Rounded wrap, smooth temples',
    shownIn: 'Pearl silver frame, smoke-blue lens',
    price: 289,               // observed on the live site; confirm before real checkout
    frames: FRAMES.map(f => f.name), lenses: LENSES.map(l => l.name),
    glb: '/glassi/glasses.glb',
    product: 'brand/product/version-2',
    // every arm x frame x lens has its own front and side photograph (80 images)
    colourways: { base: 'brand/product/v2', arms: { plain: 'plain', lettered: 'engraved' } },
    temples: [
      { id: 'plain', name: 'Plain', desc: 'Smooth arms', line: 'plain arms' },
      { id: 'lettered', name: 'glassi', desc: 'Engraved on the arm', line: 'glassi engraved on the arm' },
    ],
    alt: 'Pearl-white rounded wraparound sunglasses with smoke-blue lenses',
  },
};

export const CASTS = [
  { id: 'model-01', label: '01', desc: 'Current campaign' },
  { id: 'model-02', label: '02', desc: 'Casting option' },
  { id: 'model-03', label: '03', desc: 'Casting option' },
];
export const ASSET_V = 'v=20261103b';   // bump when replacing images so browsers and the CDN fetch the new files
export const campaignSrc = (cast, version, style, w = 1600) => `/glassi/brand/campaign/${cast}-${version}-${style}-${w}.webp?${ASSET_V}`;

export const slug = n => n.toLowerCase().replace(/\s+/g, '-');
export const money = n => 'A$' + n.toLocaleString('en-AU');
