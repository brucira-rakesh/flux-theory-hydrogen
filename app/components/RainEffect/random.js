function random(from = null, to = null, interpolation = null) {
  let a = from;
  let b = to;
  if (a == null) {
    a = 0;
    b = 1;
  } else if (a != null && b == null) {
    b = a;
    a = 0;
  }
  const delta = b - a;
  const interp = interpolation ?? ((n) => n);
  return a + interp(Math.random()) * delta;
}
function chance(c) {
  return random() <= c;
}
export {
  chance,
  random
};
