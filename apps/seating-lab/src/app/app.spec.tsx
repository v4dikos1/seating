import { fireEvent, render, screen } from '@testing-library/react';

import App from './app';

describe('App', () => {
  it('asks to sign in before showing any workspace', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Вход' })).toBeTruthy();
    expect(screen.getByLabelText('Адрес сервиса')).toBeTruthy();
    // До входа рабочие экраны не строятся: списки не запрашиваются без субъекта.
    expect(screen.queryByRole('heading', { name: 'Залы' })).toBeNull();
  });

  it('offers a token as the alternative to the password grant', () => {
    render(<App />);
    expect(screen.getByLabelText('Пользователь')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'По токену' }));
    expect(screen.getByLabelText('Access token')).toBeTruthy();
    expect(screen.queryByLabelText('Пользователь')).toBeNull();
  });
});
