use anchor_lang::prelude::*;

use crate::logic::{compose_pack, create_hash_and_vote, AccountFingerprint};
use crate::state::{HashAccount, HashSource};
use crate::utils::read_account;
use crate::ErrorCode;

#[derive(Accounts)]
pub struct Pack<'info> {
    /// CHECK: Created and initialized within this instruction.
    #[account(mut)]
    pub pack_hash_account: AccountInfo<'info>,

    /// CHECK: Created and initialized within this instruction.
    #[account(mut)]
    pub vote_info: AccountInfo<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn pack(ctx: Context<Pack>) -> Result<()> {
    let pack_account = &ctx.accounts.pack_hash_account;
    let vote_account = &ctx.accounts.vote_info;
    let payer = &ctx.accounts.payer;
    let payer_account = payer.to_account_info();
    let payer_key = payer.key();
    let system_program = ctx.accounts.system_program.to_account_info();
    let program_id = ctx.program_id;

    require!(
        !ctx.remaining_accounts.is_empty(),
        ErrorCode::PackMembersEmpty
    );

    let mut members: Vec<AccountFingerprint> = Vec::with_capacity(ctx.remaining_accounts.len());

    for account_info in ctx.remaining_accounts.iter() {
        require!(
            *account_info.owner == *program_id,
            ErrorCode::PackMemberWrongProgram
        );

        let hash_account: HashAccount = read_account(account_info)?;
        hash_account.verify_account(program_id, account_info)?;
        require!(hash_account.created_at != 0, ErrorCode::HashNotFound);

        members.push(AccountFingerprint::from_account(&hash_account));
    }

    let pack_hash = compose_pack(&members)?;
    let source = HashSource::pack();

    create_hash_and_vote(
        program_id,
        &payer_account,
        &system_program,
        pack_account,
        vote_account,
        source,
        pack_hash,
        &payer_key,
    )?;

    Ok(())
}
