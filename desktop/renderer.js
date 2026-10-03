const status = document.getElementById('status')
function render(state) {
  document.getElementById('folder').textContent = state.folder
    ? state.folder.split('/').at(-1)
    : 'No folder connected yet.'
  document.getElementById('agent').textContent = state.signedIn
    ? 'Signed in. Ready to help with your writing.'
    : 'Sign in once with your existing account.'
  document.getElementById('sign-in').disabled = state.signingIn || state.signedIn
  document.getElementById('autostart').checked = state.autoStart
  status.textContent = state.message
}
async function action(name) {
  try {
    render(await window.connectApp.action(name))
  } catch {
    status.textContent = 'Something went wrong. Please try again.'
  }
}
document
  .querySelectorAll('[data-action]')
  .forEach((button) => button.addEventListener('click', () => action(button.dataset.action)))
document.getElementById('autostart').addEventListener('change', () => action('toggle-login'))
window.connectApp.onState(render)
void action('state')
