// Testers page: the two-step join checklist and the in-app browser banner.
// Everything works without this script (the steps are plain links); it only adds guidance.
// Progress is kept in this browser (localStorage), never sent anywhere.
(function () {
  var $ = function (id) { return document.getElementById(id); };

  // --- Opened inside Facebook, Instagram or Messenger: their browsers aren't signed in to Google.
  var ua = navigator.userAgent || '';
  var inApp = /FBAN|FBAV|FB_IAB|FBIOS|Instagram|Messenger|Orca-Android/i.test(ua);
  if (inApp) {
    var name = /Instagram/i.test(ua) ? 'Instagram' : /Messenger|Orca/i.test(ua) ? 'Messenger' : 'Facebook';
    $('inapp-text').textContent =
      "You're in " + name + "'s own browser, which isn't signed in to your Google account, so joining won't work here.";
    if (/Android/i.test(ua)) {
      // Hands the page to Chrome; the menu instruction stays as a fallback.
      $('inapp-open').hidden = false;
      $('inapp-alt').innerHTML = 'Or tap ⋮ at the top right, then <em>Open in browser</em>.';
    }
    $('inapp').hidden = false;
  }

  // --- Checklist progress: '' (start), 'tapped' (opened the group page) or 'joined' (confirmed).
  var KEY = 'novelroute-join';
  var read = function () { try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; } };
  var write = function (value) {
    try { value ? localStorage.setItem(KEY, value) : localStorage.removeItem(KEY); } catch (e) { /* private mode */ }
  };

  function render(state) {
    var joined = state === 'joined';
    $('step-1').className = joined ? 'done' : 'current';
    $('step-2').className = joined ? 'current' : '';
    $('confirm').hidden = state !== 'tapped';
    $('joined-note').hidden = !joined;
    $('restart').hidden = !joined;
  }

  // Opening the group page doesn't mean joining it, so ask when they're back.
  $('join').addEventListener('click', function () {
    if (read() !== 'joined') { write('tapped'); render('tapped'); }
  });
  $('joined').addEventListener('click', function () { write('joined'); render('joined'); });
  $('not-yet').addEventListener('click', function () { write(''); render(''); });
  $('start-again').addEventListener('click', function () {
    write(''); render('');
    $('step-1').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  var state = read();
  render(state);
  // Coming back part-way: start at the step they're up to.
  if (state === 'joined') $('step-2').scrollIntoView({ block: 'center' });
  if (state === 'tapped') $('confirm').scrollIntoView({ block: 'center' });
})();
