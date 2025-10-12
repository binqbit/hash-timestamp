use anchor_lang::prelude::*;

use crate::logic::{create_hash_and_vote, hash_account_metadata};
use crate::state::HashSource;

#[derive(Accounts)]
pub struct AccountHash<'info> {
    /// CHECK: Created and initialized within this instruction.
    #[account(mut)]
    pub hash_account: AccountInfo<'info>,

    /// CHECK: Created and initialized within this instruction.
    #[account(mut)]
    pub vote_info: AccountInfo<'info>,

    /// CHECK: Read-only; metadata is hashed but not otherwise trusted.
    pub target: AccountInfo<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn account_hash(ctx: Context<AccountHash>) -> Result<()> {
    let hash_account = &ctx.accounts.hash_account;
    let vote_account = &ctx.accounts.vote_info;
    let target_account = &ctx.accounts.target;
    let payer = &ctx.accounts.payer;
    let payer_account = payer.to_account_info();
    let system_program = ctx.accounts.system_program.to_account_info();
    let program_id = ctx.program_id;

    let metadata_hash = hash_account_metadata(target_account)?;
    let source = HashSource::account(target_account.key());
    let voter = payer.key();

    create_hash_and_vote(
        program_id,
        &payer_account,
        &system_program,
        hash_account,
        vote_account,
        source,
        metadata_hash,
        &voter,
    )?;

    Ok(())
}
