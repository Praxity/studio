// Pinned dictionary/shape vectors. Tag 9 stores big-endian UTF-16 code units.
export default [
	{
		name: "expanded state and ordered rows",
		wire: '["praxity-evidence-1",677,377,[1,1,1],3082756728,4147479884,"ASNFZ4mrze8BI0VniavN76urq6urq6urq6urq6urq6urq6urq6urq6urq6urq6urAAECAwQFBgcICQoLeJxdj01OAzEMhfMzTjJQ7sAVQGxZVFwACbEehRmXRp2ZRIkH2l25BTu4AidA4hRdVJwBJA5ApiogYcmS5Wc/f+ZawuTOJUfYXNpbTDBxPWG0NTnfJ1D1kMh3GoRrwERMIXcRdO1jxJoAUq4QSnIdJrJdgIklwi5Quk7YwGFnl9N9Q/4z+VtScHDT+npxRZaw5FsGEKL3s2w/95HAzPZAUFZVVshXFS/5Js8p26d7jJlojvUiX/xF+wG58ENPoOcuPxJXHEzwbTvkfw3TAkQ4zXmiheGKjZZCNnL9/Pn2cia5FEYoBkc+Nq63cXX88fS4lg871UhTGNDFuLNDLkaxVGy5YWy6ZZvzdyayQxYWGEhxJYrXL7YLo8Q3ChVu+A=="]',
		expected: {
			visitedPages: ["p2", "p1"],
			interactions: [
				{
					id: "01234567-89ab-cdef-0123-456789abcdef",
					response: "\ud800",
					correct: true,
					score: 100,
					timestamp: 1800000000000,
					attemptsUsed: 1,
					maxAttempts: 2,
				},
				{
					id: "01234567-89ab-cdef-0123-456789abcdef",
					response: "ordinary \ud83d\ude00",
					timestamp: 1800000000001,
				},
			],
			custom:
				'{"blockState":{"\\ud800":{"answer":["\\ud800","\\udc00","\ud83d\ude00","x\\ud800A\\udc00\ud83d\ude00"],"checked":true,"correct":false,"attemptCount":2,"history":null}},"\\udc00":"kept","proof":"sha256:abababababababababababababababababababababababababababababababab","short":"s96:AAECAwQFBgcICQoL","fraction":-1.25,"__proto__":{"polluted":true}}',
		},
	},
	{
		name: "opaque custom text",
		wire: '["praxity-evidence-1",107,129,[0,0,0],4123595340,1548002525,"eJxjYGRm5SnLLM4sSU0JSExPLWblycwrSS1KTC7JzM8rZmVLLi0uyc/lYGAHQk5NBgUgrAZiJYZEhjyGYoZyhlSGIiDPCiwWw1DKkMJgwWAAhEoMOmCxVIZchnyGLIZMmKobtvcYgGwFhloGrjsMAF27GeI="]',
		expected: {
			visitedPages: [],
			interactions: [],
			custom: '  { "answer": "\\ud800", "emoji": "\ud83d\ude00" }\n\udc00',
		},
	},
];
