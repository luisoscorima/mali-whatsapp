/**
 * Escapa caracteres especiales para usar el patrón en ILIKE ... ESCAPE '!'
 * (! es el carácter de escape; % y _ literales del usuario no actúan como comodines).
 */
function escapeForLikePattern(s) {
  return String(s).replace(/!/g, '!!').replace(/%/g, '!%').replace(/_/g, '!_');
}

module.exports = { escapeForLikePattern };
