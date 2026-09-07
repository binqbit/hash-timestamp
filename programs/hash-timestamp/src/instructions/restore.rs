use anchor_lang::prelude::*;

use crate::protocol::restore::ProofGraph;
pub use crate::protocol::restore::{
    RestoreAccountSnapshot, RestoreHashFingerprint, RestoreParameters, RestoreProofLink,
};
use crate::runtime::record_lifecycle::RecordWriter;
use crate::runtime::restore::{validate_anchor, BoundAccountPairs};

#[derive(Accounts)]
pub struct Restore<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: The existing on-chain hash account that anchors the proof graph ("tip").
    /// Verified by the restore preflight before execution.
    pub anchor_hash_account: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

/// Bind accounts, validate the whole history, then execute only the missing-record plan.
pub fn restore<'info>(
    ctx: Context<'_, '_, '_, 'info, Restore<'info>>,
    proof_chain: Vec<RestoreProofLink>,
) -> Result<()> {
    let payer = ctx.accounts.payer.key();
    let accounts =
        BoundAccountPairs::bind(ctx.program_id, &payer, &proof_chain, ctx.remaining_accounts)?;
    let graph = ProofGraph::parse(&proof_chain)?;
    validate_anchor(
        ctx.program_id,
        &ctx.accounts.anchor_hash_account,
        graph.tip(),
    )?;
    let accounts = accounts.validate(ctx.program_id, &payer, &proof_chain)?;
    let validated = graph.validate(accounts.existing_indices())?;
    let plan = accounts.plan(validated)?;

    let creation_count = plan.len();
    let writer = RecordWriter::new(
        ctx.program_id,
        &ctx.accounts.payer,
        &ctx.accounts.system_program,
    );
    plan.execute(&writer)?;
    crate::debug_log!(
        "checkpoint=instruction.done instruction=restore validated={} created={}",
        proof_chain.len(),
        creation_count
    );
    Ok(())
}
