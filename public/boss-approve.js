// Boss approval page — require a comment when Reject is clicked. Loaded
// from a <script src> on the approval page so it satisfies the worker's
// strict CSP (script-src 'self'). The page also has server-side validation
// (re-renders the form with an error banner) so this is purely UX polish.
(function () {
  var form = document.getElementById("decide-form");
  if (!form) return;
  form.addEventListener("submit", function (e) {
    var btn = e.submitter;
    var ta = document.getElementById("comment");
    if (btn && btn.value === "reject" && ta && !ta.value.trim()) {
      e.preventDefault();
      ta.focus();
      ta.setCustomValidity("Please add a short reason when rejecting.");
      ta.reportValidity();
    }
  });
  var ta = document.getElementById("comment");
  if (ta) {
    ta.addEventListener("input", function () {
      ta.setCustomValidity("");
    });
  }
})();
