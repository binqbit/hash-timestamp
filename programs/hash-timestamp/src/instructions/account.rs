use anchor_lang::prelude::*;

use crate::runtime::metadata::hash_account_metadata;
use crate::runtime::{hash_record::NewHashRecord, record_lifecycle::RecordWriter};
use crate::state::HashSource;

#[derive(Accounts)]
pub struct AccountHash<'info> {
    /// CHECK: Created and initialized within this instruction.
    #[account(mut)]
    pub hash_account: UncheckedAccount<'info>,

    /// CHECK: Created and initialized within this instruction.
    #[account(mut)]
    pub vote_info: UncheckedAccount<'info>,

    /// CHECK: Read-only; metadata is hashed but not otherwise trusted.
    pub target: UncheckedAccount<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn account_hash(ctx: Context<AccountHash>) -> Result<()> {
    let accounts = ctx.accounts;
    let source = HashSource::account(accounts.target.key());
    let hash = hash_account_metadata(&accounts.target)?;
    let record = NewHashRecord::now(source, hash)?;

    let writer = RecordWriter::new(ctx.program_id, &accounts.payer, &accounts.system_program);
    writer.create_with_initial_vote(&accounts.hash_account, &accounts.vote_info, record)?;
    crate::debug_log!(
        "checkpoint=instruction.done instruction=account target={} hash={}",
        accounts.target.key(),
        accounts.hash_account.key()
    );
    Ok(())
}
