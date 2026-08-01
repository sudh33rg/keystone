import { App } from './App.js';

const root = document.getElementById('root');
if (!root) throw new Error('Keystone webview root element is missing.');
ReactDOM.render(React.createElement(App), root);
