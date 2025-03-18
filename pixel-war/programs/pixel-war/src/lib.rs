use anchor_lang::prelude::*;

declare_id!("FtcPZ5sAdSfE8K9suZ98xnhXBBgpnpHXGVu44wXzdtbL");

#[program]
pub mod pixel_war {
    use super::*;

    pub fn initialize_canvas(ctx: Context<InitializeCanvas>, quadrant: u8, x: u8, y: u8) -> Result<()> {
        require!(quadrant < 4, PixelWarError::InvalidQuadrrant);
        require!(x < 10 && y < 10, PixelWarError::InvalidSubsectionCoordinates);
        let canvas_meta = &mut ctx.accounts.canvas_meta;
        canvas_meta.initialized = true;
        let subsection = &mut ctx.accounts.subsection;
        subsection.quadrant = quadrant;
        subsection.x = x;
        subsection.y = y;
        subsection.pixels = [0; 50];
        Ok(())
    }

    pub fn create_session(ctx: Context<CreateSession>, expiry: i64) -> Result<()> {
        let session = &mut ctx.accounts.session;
        session.authority = ctx.accounts.authority.key();
        session.ephemeral_key = ctx.accounts.ephemeral_key.key();
        session.expiry = expiry;
        Ok(())
    }

    pub fn draw_pixels_direct(ctx: Context<DrawPixelDirect>, pixels: Vec<Pixel>) -> Result<()> {
        let subsection = &mut ctx.accounts.subsection;

        require!(ctx.accounts.authority.is_signer, PixelWarError::AuthorityMustSign);

        for pixel in pixels {
            require!(pixel.x < 10 && pixel.y < 10, PixelWarError::InvalidPixelCoordinates);
            require!(pixel.color < 16, PixelWarError::InvalidColor);
            let index = (pixel.x * 10 + pixel.y) as usize;
            let byte_index = index / 2;
            let is_high_nibble = index % 2 == 1;
            if is_high_nibble {
                subsection.pixels[byte_index] = (subsection.pixels[byte_index] & 0x0F) | (pixel.color << 4);
            } else {
                subsection.pixels[byte_index] = (subsection.pixels[byte_index] & 0xF0) | pixel.color;
            }
        }
        Ok(())
    }

    pub fn draw_pixels_with_session(ctx: Context<DrawPixelWithSession>, pixels: Vec<Pixel>) -> Result<()> {
        let subsection = &mut ctx.accounts.subsection;
        let clock = Clock::get()?;

        let session = &ctx.accounts.session_token;
        require!(session.to_account_info().owner == ctx.program_id, PixelWarError::InvalidAuthority);
        require!(session.authority == ctx.accounts.authority.key(), PixelWarError::InvalidAuthority);
        require!(session.ephemeral_key == ctx.accounts.ephemeral_signer.key(), PixelWarError::InvalidEphemeralKey);
        require!(clock.unix_timestamp < session.expiry, PixelWarError::SessionExpired);

        for pixel in pixels {
            require!(pixel.x < 10 && pixel.y < 10, PixelWarError::InvalidPixelCoordinates);
            require!(pixel.color < 16, PixelWarError::InvalidColor);
            let index = (pixel.x * 10 + pixel.y) as usize;
            let byte_index = index / 2;
            let is_high_nibble = index % 2 == 1;
            if is_high_nibble {
                subsection.pixels[byte_index] = (subsection.pixels[byte_index] & 0x0F) | (pixel.color << 4);
            } else {
                subsection.pixels[byte_index] = (subsection.pixels[byte_index] & 0xF0) | pixel.color;
            }
        }
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(quadrant: u8, x: u8, y: u8)]
pub struct InitializeCanvas<'info> {
    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + 1,
        seeds = [b"canvas-meta"],
        bump
    )]
    pub canvas_meta: Account<'info, CanvasMeta>,
    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + 1 + 1 + 1 + 50,
        seeds = [b"subsection", quadrant.to_le_bytes().as_ref(), x.to_le_bytes().as_ref(), y.to_le_bytes().as_ref()],
        bump
    )]
    pub subsection: Account<'info, Subsection>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CreateSession<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + 32 + 32 + 8,
        seeds = [b"session", authority.key().as_ref(), ephemeral_key.key().as_ref()],
        bump
    )]
    pub session: Account<'info, Session>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub ephemeral_key: SystemAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DrawPixelDirect<'info> {
    #[account(mut)]
    pub subsection: Account<'info, Subsection>,
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DrawPixelWithSession<'info> {
    #[account(mut)]
    pub subsection: Account<'info, Subsection>,
    pub authority: SystemAccount<'info>,
    #[account(
        seeds = [b"session", authority.key().as_ref(), ephemeral_signer.key().as_ref()],
        bump
    )]
    pub session_token: Account<'info, Session>,
    pub ephemeral_signer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[account]
pub struct CanvasMeta {
    pub initialized: bool,
}

#[account]
pub struct Subsection {
    pub quadrant: u8,
    pub x: u8,
    pub y: u8,
    pub pixels: [u8; 50],
}

#[account]
pub struct Session {
    pub authority: Pubkey,
    pub ephemeral_key: Pubkey,
    pub expiry: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct Pixel {
    pub x: u8,
    pub y: u8,
    pub color: u8,
}

#[error_code]
pub enum PixelWarError {
    #[msg("Pixel coordinates must be between 0 and 9")]
    InvalidPixelCoordinates,
    #[msg("Authority must sign if no session token is provided")]
    AuthorityMustSign,
    #[msg("Invalid authority in session token")]
    InvalidAuthority,
    #[msg("Invalid ephemeral key in session token")]
    InvalidEphemeralKey,
    #[msg("Session has expired")]
    SessionExpired,
    #[msg("Quadrrant must be between 0 and 3")]
    InvalidQuadrrant,
    #[msg("Subsection coordinates must be between 0 and 9")]
    InvalidSubsectionCoordinates,
    #[msg("Color must be between 0 and 15")]
    InvalidColor,
}