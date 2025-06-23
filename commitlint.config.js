module.exports = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "subject-case": [0, "never"],
    "subject-empty": [0, "never"], // Ignore empty subject warnings
    "type-empty": [2, "never"], // Ignore empty type warnings
    "type-enum": [2, "always", ["feat", "fix", "BREAKING CHANGE"]],
  },
};
