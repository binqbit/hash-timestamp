use anchor_lang::prelude::*;

pub(crate) fn transfer_from_program_account(
    program_id: &Pubkey,
    source: &AccountInfo,
    destination: &AccountInfo,
    amount: u64,
) -> Result<()> {
    if source.owner != program_id {
        return Err(ProgramError::IllegalOwner.into());
    }
    if source.key() == destination.key() {
        return Err(ProgramError::InvalidArgument.into());
    }

    if amount == 0 {
        return Ok(());
    }

    let source_after = source
        .lamports()
        .checked_sub(amount)
        .ok_or(ProgramError::InsufficientFunds)?;
    let destination_after = destination
        .lamports()
        .checked_add(amount)
        .ok_or(ProgramError::ArithmeticOverflow)?;

    // Resolve both borrows and both balances before changing either account.
    let mut source_lamports = source.try_borrow_mut_lamports()?;
    let mut destination_lamports = destination.try_borrow_mut_lamports()?;
    **source_lamports = source_after;
    **destination_lamports = destination_after;
    Ok(())
}

pub(crate) fn close_program_account(
    program_id: &Pubkey,
    account: &AccountInfo,
    recipient: &AccountInfo,
) -> Result<()> {
    let balance = account.lamports();
    transfer_from_program_account(program_id, account, recipient, balance)?;
    account.assign(&anchor_lang::system_program::ID);
    account.resize(0).map_err(Into::into)
}
