use std::io::Cursor;

use anchor_lang::prelude::*;
use anchor_lang::{AccountDeserialize, AccountSerialize};

pub(crate) fn read<T: AccountDeserialize>(account: &AccountInfo) -> Result<T> {
    let data = account.try_borrow_data()?;
    let mut bytes: &[u8] = &data;
    T::try_deserialize(&mut bytes)
}

pub(crate) fn write<T: AccountSerialize>(account: &AccountInfo, value: &T) -> Result<()> {
    let mut data = account.try_borrow_mut_data()?;
    value.try_serialize(&mut Cursor::new(&mut data[..]))
}
