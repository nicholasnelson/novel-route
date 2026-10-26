// Testers page: the two-step join checklist and the in-app browser banner.
// Everything works without this script (the steps are plain links); it only adds guidance.
// Progress is kept in this browser (localStorage), never sent anywhere.
(function () {
  var $ = function (id) { return document.getElementById(id); };

  // --- Opened inside another app's browser (Facebook, Messenger, Instagram and other Android apps'
  // built-in browsers, which show up as "wv"): it isn't signed in to Google, so joining shows
  // "You don't have permission". Gmail and Chrome custom tabs share Chrome's sign-in and aren't caught.
  var ua = navigator.userAgent || '';
  var named = /FBAN|FBAV|FB_IAB|FBIOS|Instagram|Messenger|Orca-Android/i.test(ua);
  var inApp = named || (/Android/i.test(ua) && /; wv\)/.test(ua));
  if (inApp) {
    var name = /Instagram/i.test(ua) ? "Instagram's" : /Messenger|Orca/i.test(ua) ? "Messenger's"
      : named ? "Facebook's" : "another app's";
    $('inapp-text').textContent =
      "You're in " + name + " built-in browser, which isn't signed in to your Google account, so joining won't work here.";
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

  // The "Seeing …?" help: a link to one (from the notice at the top) opens it.
  function openHelp() {
    var help = location.hash && document.getElementById(location.hash.slice(1));
    if (help && help.tagName === 'DETAILS') help.open = true;
  }
  window.addEventListener('hashchange', openHelp);
  // Tapping the same link twice doesn't change the hash, so open it on the tap too.
  document.querySelectorAll('a[href^="#help-"]').forEach(function (link) {
    link.addEventListener('click', function () { document.getElementById(link.hash.slice(1)).open = true; });
  });
  openHelp();

  var state = read();
  render(state);
  // Coming back part-way: start at the step they're up to.
  if (state === 'joined') $('step-2').scrollIntoView({ block: 'center' });
  if (state === 'tapped') $('confirm').scrollIntoView({ block: 'center' });
})();
