const { Connection, PublicKey } = require("@solana/web3.js");

(async () => {
    try {
        const connection = new Connection("https://staging-rpc.dev2.eclipsenetwork.xyz", "confirmed");
        const programId = new PublicKey("CezwbVjnXg9G62CLSDtynxV91YeLEzNgqF4qtXYL4DVd");

        const grid = Array(200).fill().map(() => Array(200).fill(0));

        const [subsectionPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("subsection"), Buffer.from([0]), Buffer.from([0]), Buffer.from([0])],
            programId
        );

        const accountInfo = await connection.getAccountInfo(subsectionPda);
        if (accountInfo) {
            const data = accountInfo.data;
            const pixels = data.slice(11); // Après discriminant (8) + quadrant (1) + x (1) + y (1)

            for (let i = 0; i < 10; i++) {
                for (let j = 0; j < 10; j++) {
                    const index = i * 10 + j;
                    const byte = pixels[Math.floor(index / 2)];
                    grid[i][j] = (index % 2 === 0) ? (byte & 0x0F) : (byte >> 4); // Décompresse 4 bits
                }
            }
        }

        console.log("Canvas 200x200 (sous-section (0,0,0) uniquement pour lisibilité) :");
        for (let i = 0; i < 10; i++) {
            console.log(grid[i].slice(0, 10).map(val => val.toString().padStart(3, ' ')).join(" "));
        }

    } catch (err) {
        console.error("Erreur :", err);
    }
})();