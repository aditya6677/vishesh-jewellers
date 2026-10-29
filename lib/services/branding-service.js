'use strict';
const defaults = Object.freeze({ name: 'Vishesh Jewellers', tagline: 'Beginning... of Special Relationship...', logo: '' });
function imageDimensions(bytes, type) {
  if (type === 'png') return bytes.length >= 33 && bytes.toString('ascii',12,16) === 'IHDR' ? [bytes.readUInt32BE(16),bytes.readUInt32BE(20)] : [0,0];
  let offset = 2;
  while (offset + 4 < bytes.length) {
    if (bytes[offset++] !== 255) return [0,0];
    while (bytes[offset] === 255) offset++;
    const marker = bytes[offset++];
    if ([217,218].includes(marker)) break;
    if (marker === 1 || marker >= 208 && marker <= 215) continue;
    if (offset + 2 > bytes.length) break;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) break;
    if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker) && length >= 8) return [bytes.readUInt16BE(offset+5),bytes.readUInt16BE(offset+3)];
    offset += length;
  }
  return [0,0];
}
function validateBranding(input) {
  const fail = message => { throw Object.assign(new Error(message), { statusCode: 400 }); };
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Enter valid store branding.');
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 100) fail('Store name is required (up to 100 characters).');
  if (typeof input.tagline !== 'string' || input.tagline.length > 160) fail('Tagline must be up to 160 characters.');
  if (typeof input.logo !== 'string') fail('Choose a PNG or JPEG logo.');
  if (input.logo) {
    const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(input.logo);
    if (!match) fail('Only PNG and JPEG logos are supported.');
    const bytes = Buffer.from(match[2], 'base64');
    if (!bytes.length || bytes.length > 1_000_000 || bytes.toString('base64') !== match[2]) fail('Logo must be a valid image up to 1 MB.');
    if (match[1] === 'png' ? !bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255) fail('Image contents do not match the selected logo format.');
    if (imageDimensions(bytes, match[1]).some(dimension => dimension < 1 || dimension > 4096)) fail('Logo must contain a valid image up to 4096 × 4096 pixels.');
  }
  return { name: input.name.trim(), tagline: input.tagline.trim(), logo: input.logo };
}
class BrandingService {
  constructor(store) { this.store = store; }
  read() { const value = this.store.getValue ? this.store.getValue('business-info') : this.store.read()['business-info']; return { ...defaults, ...Object.fromEntries(Object.keys(defaults).filter(key => typeof value?.[key] === 'string').map(key => [key, value[key]])) }; }
  save(input) {
    const branding = validateBranding(input);
    if (this.store.setValue) this.store.setValue('business-info', { ...(this.store.getValue('business-info') || {}), ...branding });
    else { const data = this.store.read(); data['business-info'] = { ...data['business-info'], ...branding }; this.store.write(data); }
    return branding;
  }
}
module.exports = { BrandingService, validateBranding };
