// Minimal mocks of the JCI CMU browser environment for local dev.
var log = {
	addSrcFile: function () {},
	debug: function () { console.log.apply(console, arguments); },
	error: function () { console.error.apply(console, arguments); }
};

var framework = {
	_currentAppUiaId: 'system',
	getCurrentApp: function () { return this._currentAppUiaId; },
	getCurrCtxtId: function () { return 'Applications'; },
	localize: { _appDicts: { system: {} } },
	log: { error: function (m) { console.error(m); } }
};

// Press 'a' to simulate leaving/re-entering the Applications screen
// (launcher button should hide/show).
document.addEventListener('keydown', function (e) {
	if (e.key === 'a') {
		framework._currentAppUiaId = framework._currentAppUiaId === 'system' ? 'other' : 'system';
		console.log('framework app ->', framework._currentAppUiaId);
	}
});
