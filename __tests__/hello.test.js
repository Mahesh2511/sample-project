const hello = () => "Hello, World!";

test("returns hello world text", () => {
  expect(hello()).toBe("Hello, World!");
});
