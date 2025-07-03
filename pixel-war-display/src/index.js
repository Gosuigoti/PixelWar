import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { BackpackWalletAdapter } from '@solana/wallet-adapter-backpack';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { clusterApiUrl } from '@solana/web3.js';
import '@solana/wallet-adapter-react-ui/styles.css';
import { Buffer } from 'buffer'; // Importer Buffer
import { BrowserRouter as Router } from 'react-router-dom';

// Ajouter Buffer globalement
window.Buffer = window.Buffer || Buffer;

// Définir le réseau (par exemple, Devnet ou un réseau personnalisé)
const network = WalletAdapterNetwork.Devnet;
const endpoint = 'https://eclipse.helius-rpc.com'; // Votre endpoint personnalisé
const wallets = [new BackpackWalletAdapter()];

const root = ReactDOM.createRoot(document.getElementById('root'));

root.render(
  <React.StrictMode>
    <Router>
      <ConnectionProvider endpoint={endpoint}>
        <WalletProvider wallets={wallets} autoConnect>
          <WalletModalProvider>
            <App />
          </WalletModalProvider>
        </WalletProvider>
      </ConnectionProvider>
    </Router>
  </React.StrictMode>
);