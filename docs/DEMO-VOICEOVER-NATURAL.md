# FUSE demo — natural narration script

Voice: en-US-AndrewMultilingualNeural at +6%, pitch -1Hz
Output: `/workspace/fuse-demo/FUSE-demo-natural.mp4`
Duration: 3:54.35 (matches the original)

## 0:00–0:23  A · One wallet approval for a complete route

- **[0:00.12–0:03.38]** A Bitcoin Cash wallet can pay someone in a single transaction.
- **[0:03.92–0:08.42]** A trade that needs a loan, two liquidity pools, and a repayment is harder.
- **[0:08.56–0:12.43]** Every contract has to accept the same set of inputs and outputs.
- **[0:13.00–0:18.14]** Fuse builds that transaction, and lets the wallet holder inspect the cost before they approve it.
- **[0:18.36–0:22.01]** We can trace one recorded execution all the way to a confirmed block.

## 0:23–0:47  B · Borrowing from a FlashVault

- **[0:24.03–0:28.56]** The vault is an unspent BCH output that carries an identity NFT.
- **[0:28.68–0:32.78]** Spending it makes its principal available inside that same transaction.  _(tempo 1.029)_
- **[0:32.90–0:39.67]** The covenant checks that the same script and NFT come back at the same index, with the required fee and the updated counter.  _(tempo 1.038)_
- **[0:39.79–0:46.40]** In the recorded negative test, a repayment that was one satoshi short failed in the local Bitcoin Cash virtual machine.

## 0:47–1:18  B · One purchase, one sale, one repayment

- **[0:47.88–0:53.29]** Let's follow the two-pool transaction in block 978,214.
- **[0:53.75–0:59.24]** The first pool received 5,306 satoshis for one unit of Paryon USD.
- **[1:00.11–1:03.44]** The second returned 5,273.
- **[1:04.00–1:06.72]** The trade lost 33 satoshis.
- **[1:06.84–1:12.85]** Including the vault fee and miner fee, the wallet spent 1,991 satoshis.
- **[1:13.25–1:17.34]** The receipt lets a judge check both pool continuations and the repayment.

## 1:18–1:43  C · Two signed quotes at the same cost

- **[1:18.70–1:23.43]** In a separate mainnet run, two solver processes answered a signed request for a quote.
- **[1:24.29–1:26.08]** Both of them belonged to the operator.
- **[1:26.59–1:30.07]** Fuse verified the signatures and recomputed both routes.
- **[1:30.46–1:34.54]** They each cost the user 1,991 satoshis.
- **[1:35.19–1:36.55]** The quote hash broke the tie.
- **[1:37.17–1:41.79]** The winning quote, the authorization, and the settlement are all linked in the evidence index.

## 1:43–2:00  D · Cashonize pairs over WizardConnect

- **[1:43.48–1:46.03]** Here's the real pairing prompt from Cashonize.
- **[1:46.67–1:50.94]** The wallet is asking for permission to share its address information with the application.
- **[1:51.50–1:54.17]** The captured session used the first receive address.
- **[1:54.79–1:58.99]** The server handles a public signing package, and the wallet keeps the spending key.

## 2:00–2:25  D · The wallet approves an exact transaction

- **[2:00.75–2:02.40]** This is the captured signing prompt.
- **[2:02.55–2:08.91]** Cashonize, version 0.16, approved the wallet input of a mainnet flash transaction.
- **[2:09.07–2:14.78]** It preserved the covenant unlock, and used signatures committing to all outputs and source outputs.  _(tempo 1.079)_
- **[2:14.90–2:20.83]** The resulting transaction is confirmed in block 978,246.
- **[2:21.39–2:23.92]** That establishes one wallet, and one action.

## 2:25–2:48  E · Checking a receipt

- **[2:25.39–2:28.24]** A certificate can carry several kinds of evidence.
- **[2:28.72–2:31.48]** Inclusion links transaction bytes to a block.
- **[2:31.88–2:34.55]** Structure compares the inputs and outputs.
- **[2:34.89–2:39.38]** Outcome verification recomputes repayment, fees, and pool rules.
- **[2:39.50–2:43.68]** Intent binding compares the chain transaction with the signed authorization.
- **[2:44.05–2:47.71]** Here, the sandbox verifier accepts its original receipt.

## 2:48–3:11  E · The altered receipt fails

- **[2:48.93–2:51.76]** After we change the receipt, verification fails.
- **[2:52.62–2:54.78]** This screen is a sandbox demonstration.
- **[2:55.60–3:01.49]** For mainnet, the submission includes the raw transactions, the parent outputs, and the Merkle branches.
- **[3:02.07–3:06.65]** Those records exposed incorrect block heights in the original certificates.
- **[3:06.88–3:10.82]** The corrected receipts still preserve the same transaction IDs.

## 3:11–3:32  F · Guardian and Parallel Worlds

- **[3:11.82–3:15.18]** Guardian reads Paryon loan state and reports its coverage.
- **[3:15.85–3:21.15]** Parallel Worlds uses simulated funds to compare what happens when a vault is paused.  _(tempo 1.006)_
- **[3:21.27–3:26.47]** Developers can run the SDK quickstart locally and verify a sandbox certificate.
- **[3:26.65–3:31.41]** Paryon loan management and automated mainnet trading are outside this release.

## 3:32–3:54  G · Where a protocol can start

- **[3:32.52–3:35.11]** Wallet developers can start with the signing request.
- **[3:36.00–3:42.18]** Protocol teams can inspect the transaction composer, and solver operators can look at the quote transcript.
- **[3:42.74–3:47.11]** Liquidity providers can see exactly what the owner-controlled vault receives.
- **[3:47.69–3:53.86]** Open the evidence index, or the public verifier, and check the claims using the same transaction IDs.
