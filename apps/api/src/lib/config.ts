export const config = {
	/** Points earned per euro spent */
	pointsPerEuro: 1,
	/** Points needed for 1€ discount */
	pointsPerEuroDiscount: 100,
	/** Hours before a reserve_pickup reservation expires */
	reservationHours: 48,
	/** Maximum number of images per product */
	maxImagesPerProduct: 10,
	/** Fixed shipping cost in euros for pay_deliver orders */
	shippingCost: "5.00",
	/** Default pagination settings */
	pagination: {
		defaultLimit: 20,
		maxLimit: 100,
	},
} as const;
