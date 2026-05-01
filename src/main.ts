import './style.css';
import { mountApp } from './app';
import { Library } from './lib/library';

const root = document.getElementById('app');
if (root !== null) {
  mountApp(root, new Library(localStorage));
}
