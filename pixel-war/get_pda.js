const { PublicKey } = require("@solana/web3.js");
const programId = new PublicKey("CezwbVjnXg9G62CLSDtynxV91YeLEzNgqF4qtXYL4DVd");
const [pda] = PublicKey.findProgramAddressSync(
  [Buffer.from("subsection"), Buffer.from([0]), Buffer.from([0]), Buffer.from([0])],
  programId
);
console.log(pda.toBase58());