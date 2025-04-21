const CONTRACT_ADDRESS = "0x00000b9D6803f438300F2916d0148271Bb7a4c47";
const CONTROLLER_ADDRESS = "0xd1699E2D20DA3b2E7Bb9D2C2C72Fc62E7785fDD1";

const RPCS = {
    ethereum: "https://eth.llamarpc.com",
    polygon: "https://polygon-rpc.com",
    base: "https://mainnet.base.org"
};

const ERC20_ABI = [
    "function balanceOf(address) view returns (uint256)",
    "function symbol() view returns (string)",
    "function decimals() view returns (uint8)",
    "function transfer(address to, uint256 amount) returns (bool)"
];

const TOKEN_METADATA = {
    "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": {
        symbol: "USDC",
        decimals: 6
    }
};


const CONTRACT_ABI = [
    "function sweep() external",
    "function updateWhitelist(address token, bool approved) external",
    "function getTokenList() public view returns (address[])"
];

let signer, contract;

document.getElementById("vaultAddress").innerText = CONTRACT_ADDRESS;

function copyVaultAddress() {
    navigator.clipboard.writeText(CONTRACT_ADDRESS);
    alert("Address copied to clipboard!");
}

function generateQR() {
    const qrContainer = document.getElementById("qr");
    qrContainer.innerHTML = "";
    QRCode.toCanvas(document.createElement("canvas"), CONTRACT_ADDRESS, (err, canvas) => {
        if (!err) qrContainer.appendChild(canvas);
    });
}
generateQR();

document.getElementById("connectBtn").onclick = async () => {
    if (!window.ethereum) return alert("Please install MetaMask");
    await ethereum.request({ method: "eth_requestAccounts" });
    const provider = new ethers.BrowserProvider(window.ethereum);
    signer = await provider.getSigner();
    const userAddress = await signer.getAddress();
    document.getElementById("walletInfo").innerText = `Connected: ${userAddress}`;

    const isController = userAddress.toLowerCase() === CONTROLLER_ADDRESS.toLowerCase();
    document.getElementById("sweepCard").style.display = isController ? "block" : "none";
    document.getElementById("whitelistCard").style.display = isController ? "block" : "none";

    initContract();
    updateGlobalVaultValue();
};

async function updateWhitelistDisplay(chain) {
    const displayDiv = document.getElementById("whitelistDisplay");
    displayDiv.innerHTML = "Loading...";

    try {
        const provider = new ethers.JsonRpcProvider(RPCS[chain]);
        const contractView = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, provider);

        const raw = await contractView.getTokenList();
        const tokenList = Array.from(raw);

        if (!tokenList.length) {
            displayDiv.innerHTML = "<i>None</i>";
            return;
        }

        let displayHTML = "";
        for (const addr of tokenList) {
            let symbol = "Unknown";
            try {
                const token = new ethers.Contract(addr, ERC20_ABI, provider);
                const meta = TOKEN_METADATA[addr.toLowerCase()];
                symbol = meta?.symbol || await token.symbol();
            } catch {
                console.warn(`⚠️ Could not fetch symbol for token ${addr}`);
            }
            displayHTML += `<div>🔹 ${symbol} <code>${addr}</code></div>`;
        }

        displayDiv.innerHTML = displayHTML;
    } catch (err) {
        console.warn("Whitelist load failed:", err);
        displayDiv.innerText = "⚠️ Failed to load whitelist.";
    }
}


document.getElementById("network").onchange = initContract;

async function fetchPrices() {
    const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum,polygon,tether,usd-coin,wrapped-bitcoin&vs_currencies=usd");
    const data = await res.json();
    return {
        ETH: data.ethereum?.usd || 0,
        MATIC: data.polygon?.usd || 0,
        USDC: data["usd-coin"]?.usd || 0,
        USDT: data.tether?.usd || 0,
        WBTC: data["wrapped-bitcoin"]?.usd || 0
    };
}

async function initContract() {
    const chain = document.getElementById("network").value;
    const rpc = RPCS[chain];

    // 🔄 Reset all previous state
    contract = null;
    signer = signer || null;

    const provider = signer || new ethers.JsonRpcProvider(rpc);
    contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, provider);

    console.log(`[${chain}] Using contract at ${CONTRACT_ADDRESS}`);

    // Always use chain context
    await updateWhitelistDisplay(chain);
    estimateGasFee(chain);
    updateBalance(chain, rpc);
}



async function estimateGasFee(chain) {
    const gasElem = document.getElementById("gasEstimate");
    gasElem.innerText = "⛽ Estimating...";

    try {
        const rpc = RPCS[chain];
        const provider = new ethers.JsonRpcProvider(rpc);
        const vaultContract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, provider);
        const tokenList = await vaultContract.getTokenList();

        const destination = CONTROLLER_ADDRESS;

        for (const tokenAddr of tokenList) {
            const meta = TOKEN_METADATA[tokenAddr.toLowerCase()];
            const token = new ethers.Contract(tokenAddr, ERC20_ABI, provider);
            const balance = await token.balanceOf(CONTRACT_ADDRESS);

            if (balance === 0n) continue;

            const data = token.interface.encodeFunctionData("transfer", [CONTROLLER_ADDRESS, balance]);
            const gasEstimate = await provider.estimateGas({
                to: tokenAddr,
                from: CONTRACT_ADDRESS,
                data
            });

            const gasPrice = BigInt(await provider.send("eth_gasPrice", []));
            const totalCost = gasEstimate * gasPrice;
            const unit = chain === "polygon" ? "MATIC" : "ETH";

            document.getElementById("gasEstimate").innerText =
                `⛽ Sweep gas: ~${ethers.formatEther(totalCost)} ${unit}`;
            return;

        }

        gasElem.innerText = "⛽ No tokens with balance";
    } catch (err) {
        console.warn("Gas estimation error:", err);
        gasElem.innerText = "⛽ Gas: unavailable";
    }
}

async function updateBalance(chain, rpc) {
    const balanceElem = document.getElementById("balance");
    balanceElem.innerHTML = "Loading...";

    try {
        const prices = await fetchPrices();
        const provider = new ethers.JsonRpcProvider(rpc);
        const nativeBal = await provider.getBalance(CONTRACT_ADDRESS);
        const formattedNative = ethers.formatEther(nativeBal);
        const nativeUSD = parseFloat(formattedNative) * (chain === "polygon" ? prices.MATIC : prices.ETH);

        let display = `<div class="token-entry"><strong>Native:</strong> ${formattedNative} (~$${nativeUSD.toFixed(2)})</div>`;

        // Load token list from the current chain's contract
        const chainContract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, provider);
        const tokenList = await chainContract.getTokenList();

        for (const addr of tokenList) {
            try {
                const token = new ethers.Contract(addr, ERC20_ABI, provider);
                let symbol = "Unknown";
                let decimals = 18;
                let balance = 0n;

                try {
                    const meta = TOKEN_METADATA[addr.toLowerCase()];
                    if (meta) {
                        symbol = meta.symbol;
                        decimals = meta.decimals;
                    } else {
                        symbol = await token.symbol();
                        decimals = await token.decimals();
                    }
                    balance = await token.balanceOf(CONTRACT_ADDRESS);
                } catch (err) {
                    console.warn(`⚠️ Failed to load token ${addr} on ${chain}:`, err);
                    display += `<div class="token-entry"><span>⚠️ Error loading token ${addr}</span></div>`;
                    continue;
                }

                const formatted = ethers.formatUnits(balance, decimals);
                const usd = parseFloat(formatted) * (prices[symbol.toUpperCase()] || 0);

                display += `<div class="token-entry"><span>${symbol}: ${formatted} (~$${usd.toFixed(2)})</span></div>`;
            } catch (err) {
                console.warn(`⚠️ Failed to load token ${addr} on ${chain}:`, err);
                display += `<div class="token-entry"><span>⚠️ Error loading token ${addr}</span></div>`;
            }
        }

        balanceElem.innerHTML = display;
    } catch (err) {
        console.error("Error loading balances:", err);
        balanceElem.innerText = "⚠️ Error loading balances.";
    }
}


async function updateGlobalVaultValue() {
    try {
        const prices = await fetchPrices();
        let total = 0;
        for (const [chain, rpc] of Object.entries(RPCS)) {
            const provider = new ethers.JsonRpcProvider(rpc);
            const viewContract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, provider);
            const native = await provider.getBalance(CONTRACT_ADDRESS);
            total += parseFloat(ethers.formatEther(native)) * (chain === "polygon" ? prices.MATIC : prices.ETH);

            const tokens = await viewContract.getTokenList();
            for (const tokenAddr of tokens) {
                try {
                    const token = new ethers.Contract(tokenAddr, ERC20_ABI, provider);
                    const decimals = await token.decimals();
                    const bal = await token.balanceOf(CONTRACT_ADDRESS);
                    const symbol = await token.symbol();
                    total += parseFloat(ethers.formatUnits(bal, decimals)) * (prices[symbol.toUpperCase()] || 0);
                } catch { }
            }
        }

        document.getElementById("totalValue").innerText = `$${total.toFixed(2)}`;
    } catch (err) {
        console.error("Global value fetch failed:", err);
        document.getElementById("totalValue").innerText = "$0.00";
    }
}

document.getElementById("sweepBtn").onclick = async () => {
    try {
        const tx = await contract.sweep();
        document.getElementById("sweepStatus").innerText = `Sweep tx sent: ${tx.hash}`;
        triggerSweepAnimation();
    } catch (e) {
        document.getElementById("sweepStatus").innerText = "Sweep failed: " + e.message;
    }
};

function triggerSweepAnimation() {
    const el = document.getElementById("sweepAnim");
    el.innerHTML = "🌀 Sweeping...";
    setTimeout(() => el.innerHTML = "", 2000);
}

document.getElementById("updateBtn").onclick = async () => {
    const token = document.getElementById("tokenInput").value.trim();
    const approved = document.getElementById("approveSelect").value === "true";
    if (!ethers.isAddress(token)) return alert("Invalid token address.");
    try {
        const tx = await contract.updateWhitelist(token, approved);
        document.getElementById("updateStatus").innerText = `Whitelist updated: ${tx.hash}`;
    } catch (e) {
        document.getElementById("updateStatus").innerText = "Update failed: " + e.message;
    }
};
