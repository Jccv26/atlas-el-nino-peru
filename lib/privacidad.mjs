// Personal identifiers that are unnecessary for a public climate notice.
// Keep the value out of logs, even when the issuer published it openly.
export const pii = [
  ['posible correo de contacto', /\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/i],
  ['posible teléfono móvil', /(?<!\d)(?:\+?51[ .-]*)?9\d{2}[ .-]?\d{3}[ .-]?\d{3}(?!\d)/],
  ['documento o identificador individual', /\b(?:d\.?\s*n\.?\s*i\.?|carn[eé] de extranjer[ií]a|pasaporte|n[uú]mero de (?:cuenta|suministro|cliente)|c[oó]digo de (?:cliente|abonado))\s*(?:n(?:[úu]mero|ro)?[.°º]*|[:#-])?\s*[a-z]?\s*[\d -]{5,15}\d\b/i],
  ['posible DNI sin etiqueta', /(?<![\d.-])\b(?!(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\b)\d{8}\b(?![\d.-])/],
  ['posible identificación de afectado', /\b(?:menor de edad|paciente|v[ií]ctima|damnificad[oa])\s+(?:fue\s+)?(?:identificad[oa]\s+como|de nombre|de iniciales)\s+\S+/iu],
];

export const detectsPersonalData = value => typeof value === 'string' && pii.some(([,rx]) => rx.test(value));
