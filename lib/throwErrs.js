function throwErrs (...errs) {
  for (let err of errs) {
    if (err) {
      throw err
    }
  }
}

module.exports = throwErrs
