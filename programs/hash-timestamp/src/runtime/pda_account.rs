use anchor_lang::prelude::*;
use anchor_lang::system_program::{self, Allocate, Assign, CreateAccount, Transfer};

use crate::protocol::address::PdaSignerSeeds;
use crate::ErrorCode;

/// Accept only an unused System Program account as a deterministic PDA target.
/// A positive lamport balance is allowed so third-party prefunding cannot squat
/// a protocol address.
pub(crate) fn validate_vacant_system_account(account: &AccountInfo) -> Result<()> {
    require_keys_eq!(
        *account.owner,
        system_program::ID,
        ErrorCode::InvalidPdaPlaceholder
    );
    require!(
        account.data_is_empty() && !account.executable,
        ErrorCode::InvalidPdaPlaceholder
    );
    Ok(())
}

pub(crate) fn create_or_claim_pda<'info>(
    payer: &AccountInfo<'info>,
    destination: &AccountInfo<'info>,
    space: usize,
    owner: &Pubkey,
    signer_seeds: &PdaSignerSeeds,
    system_program_info: &AccountInfo<'info>,
) -> Result<u64> {
    if system_program_info.key() != system_program::ID {
        return Err(ProgramError::IncorrectProgramId.into());
    }
    validate_vacant_system_account(destination)?;

    let required_lamports = Rent::get()?.minimum_balance(space);
    if destination.lamports() == 0 {
        signer_seeds.with_signer(|signer| {
            system_program::create_account(
                CpiContext::new_with_signer(
                    system_program_info.clone(),
                    CreateAccount {
                        from: payer.clone(),
                        to: destination.clone(),
                    },
                    signer,
                ),
                required_lamports,
                space as u64,
                owner,
            )
        })?;
    } else {
        top_up_to_rent(payer, destination, required_lamports, system_program_info)?;
        allocate_and_assign(destination, space, owner, signer_seeds, system_program_info)?;
    }

    Ok(required_lamports)
}

fn top_up_to_rent<'info>(
    payer: &AccountInfo<'info>,
    destination: &AccountInfo<'info>,
    required_lamports: u64,
    system_program_info: &AccountInfo<'info>,
) -> Result<()> {
    let top_up = required_lamports.saturating_sub(destination.lamports());
    if top_up == 0 {
        return Ok(());
    }

    system_program::transfer(
        CpiContext::new(
            system_program_info.clone(),
            Transfer {
                from: payer.clone(),
                to: destination.clone(),
            },
        ),
        top_up,
    )
}

fn allocate_and_assign<'info>(
    destination: &AccountInfo<'info>,
    space: usize,
    owner: &Pubkey,
    signer_seeds: &PdaSignerSeeds,
    system_program_info: &AccountInfo<'info>,
) -> Result<()> {
    signer_seeds.with_signer(|signer| {
        system_program::allocate(
            CpiContext::new_with_signer(
                system_program_info.clone(),
                Allocate {
                    account_to_allocate: destination.clone(),
                },
                signer,
            ),
            space as u64,
        )
    })?;

    signer_seeds.with_signer(|signer| {
        system_program::assign(
            CpiContext::new_with_signer(
                system_program_info.clone(),
                Assign {
                    account_to_assign: destination.clone(),
                },
                signer,
            ),
            owner,
        )
    })
}
