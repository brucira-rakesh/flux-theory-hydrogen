function times(n, f) {
  for (let i = 0; i < n; i++) {
    f(i);
  }
}
export {
  times as default
};
