export const transformSearchData = (result) => {
    return result.map(({id, pictureUrl, title, price, manufacturerPartNumber, categoryTitle}) => {
        const obj = {
            id,
            pictureUrl,
            title,
            price,
            manufacturerPartNumber,
            categoryTitle
         };
         
         if (!price) delete obj.price;
        return obj;
    });
}