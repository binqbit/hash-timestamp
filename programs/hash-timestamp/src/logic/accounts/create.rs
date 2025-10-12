use crate::logic::hash::{new_hash_state, DerivedHash};
use crate::logic::vote::{new_state as new_vote_state, DerivedVote};
use crate::state::{HashSource, VOTE_INFO_SPACE};
use crate::utils::{create_account_with_seeds, write_account};
use crate::ErrorCode;
use anchor_lang::prelude::*;
use anchor_lang::system_program::{self, Transfer};

pub fn create_hash_account<'info>(
    program_id: &Pubkey,
    payer: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    hash_account: &AccountInfo<'info>,
    derived_hash: &DerivedHash,
    source: HashSource,
    hash: [u8; 32],
) -> Result<u64> {
    require_keys_eq!(
        hash_account.key(),
        derived_hash.key,
        ErrorCode::InvalidHashSeeds
    );
    require!(hash_account.lamports() == 0, ErrorCode::HashAlreadyExists);

    let rent = Rent::get()?;
    let space = source.space();
    let hash_rent = rent.minimum_balance(space);

    let hash_seeds = derived_hash.seeds();
    let created_hash_rent = create_account_with_seeds(
        payer,
        hash_account,
        space,
        program_id,
        &hash_seeds,
        system_program,
    )?;
    debug_assert_eq!(created_hash_rent, hash_rent);

    let hash_state = new_hash_state(source, hash, derived_hash.bump)?;
    write_account(hash_account, &hash_state)?;

    Ok(hash_rent)
}

pub fn create_vote_account_for_hash<'info>(
    program_id: &Pubkey,
    payer: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    hash_account: &AccountInfo<'info>,
    vote_account: &AccountInfo<'info>,
    derived_hash: &DerivedHash,
    derived_vote: &DerivedVote,
    vote_amount: u64,
    deposit_amount: u64,
) -> Result<()> {
    require_keys_eq!(
        vote_account.key(),
        derived_vote.key,
        ErrorCode::InvalidHashSeeds
    );
    require!(vote_account.lamports() == 0, ErrorCode::AlreadyVoted);

    require_keys_eq!(
        hash_account.key(),
        derived_hash.key,
        ErrorCode::InvalidHashSeeds
    );

    let vote_seeds = derived_vote.seeds();
    create_account_with_seeds(
        payer,
        vote_account,
        VOTE_INFO_SPACE,
        program_id,
        &vote_seeds,
        system_program,
    )?;

    let vote_state = new_vote_state(
        *derived_vote.voter(),
        *derived_hash.canonical_id(),
        vote_amount,
        derived_vote.bump,
    );
    write_account(vote_account, &vote_state)?;

    if deposit_amount > 0 {
        let transfer_ctx = CpiContext::new(
            system_program.clone(),
            Transfer {
                from: payer.clone(),
                to: hash_account.clone(),
            },
        );
        system_program::transfer(transfer_ctx, deposit_amount)?;
    }

    Ok(())
}
